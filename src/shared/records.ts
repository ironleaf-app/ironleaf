// The connected vault (WS1 part B, 24 Oct 2026). 23 Oct. Actions, follow-ups, meetings, people, files, decisions, risks
// and dates sat in separate tables and notes with nothing joining them, so no screen could say "everything about Darcy",
// "every open item from the Tessaly meeting" or "what needs me on this project". Every piece of a project is now a record
// with a stable id and a type, read from the plain Markdown the person already keeps (no file format changes): a
// project's What's next and run-sheet tick boxes, Key dates, a Workstreams table, Risks and issues, Decisions, People and
// contacts tables, Documents; People notes; meeting notes with their attendees, actions and decisions; task lines in any
// note; the files notes link to or a project keeps. Links are found by themselves, each with its reason in plain words:
//  link       a [[link]] between two things ("Links to Site Survey")
//   owner      a person named as an action's, workstream's, risk's or project's owner ("Owner")
//   attendee   a person among a meeting's attendees ("Attendee")
//   contact    a person or organisation in a project's People or contacts ("Project Manager")
//   mentions   a known person named in an item's words ("Named in it")
//   source     an action or decision written in a meeting or note, or filed from one ("From the meeting")
//   project    a thing that belongs to a project ("In the project")
//   file       a file a note or project names ("Names the file")
//   about      two items of one project about the same thing ("Both about Northgate")
//   same-day   a key date and a meeting of one project on the same day ("Same day")
//   org        a person and their organisation ("Works at Blue Peak")
//Pure (no Node, no DOM): the main side builds it from the index (src/main/indexer.ts), the window asks for a record's
// peek, the assistant's tools and the former host app (tools/build-embedded.mjs) ask the same questions of it.

import { readDay, calendarDayOf, isoDay } from './days';
import { isMachineProp } from './frontmatter';
import { findActions, isMeetingNote, notePeople, readAction, sameSubject, sameWhat, FILED_MARK } from './meetings';
import { isProjectProps, parseProject, projectOwnsFolder, type Project } from './project-file';
import { personKey } from './relations';
import { findAllTasks, isPersonNote } from './tasks';
import { inFolder } from './paths';
import { whoIsMe } from './today';
import { itemParts, readTable } from './layouts';
import { hubModel, type ConnectedAction, type HubModel } from './project-hub';
import { readDay as readTimelineDay, isoDay as isoOfDay } from './timeline';
import { STOP_WORDS as STOP } from './stop-words';
import { isFinished } from './finished';
import { fieldLabel } from './record-views';

export type RecordType = 'project' | 'action' | 'milestone' | 'workstream' | 'meeting' | 'decision' | 'risk' | 'file' | 'person' | 'org' | 'note';
export const RECORD_TYPES: RecordType[] = ['project', 'action', 'milestone', 'workstream', 'meeting', 'decision', 'risk', 'file', 'person', 'org', 'note'];
export const TYPE_WORDS: Record<RecordType, string> = {
  project: 'Project',
  action: 'Action',
  milestone: 'Milestone',
  workstream: 'Workstream',
  meeting: 'Meeting',
  decision: 'Decision',
  risk: 'Risk or issue',
  file: 'File',
  person: 'Person',
  org: 'Organisation',
  note: 'Note',
};

export type LinkKind = 'link' | 'owner' | 'attendee' | 'contact' | 'mentions' | 'source' | 'project' | 'file' | 'about' | 'same-day' | 'org';

export interface RecordFact {
  key: string;
  label: string;
  value: string;
  /** A person or other record the value names (so the peek can make it a link). */
  ref?: string;
  /** Several records the value names, each with its words as shown (a meeting's attendees): each a link in the peek. */
  refs?: { id: string; name: string }[];
}

export interface VaultRecord {
  id: string;
  type: RecordType;
  title: string;
  /** The note it is written in (a vault file: its own path; a file in a project's folder: the project's file). */
  path: string;
  /** Its line in that note (0 is the first line of the file, properties counted). */
  line?: number;
  /** The project it belongs to (the project file's path). */
  project?: string;
  /** A project: the person's own late steps here (hubModel with connected, like Projects.list), so Connected
   *  and Home weigh the same health (p10-vault-connected C3, 4 Nov 2026). */
  lateMine?: number;
  /** Where it sits on its project's page ("next:3", "dates:1", "decisions:0", "risks:2"), to open the page at it. */
  item?: string;
  owner?: string;
  /** Due (an action) or the day (a milestone, meeting or decision), as YYYY-MM-DD when it can be read. */
  due?: string;
  date?: string;
  /** As written ("by Mon 26 Oct", "Week of 12 Oct"). */
  when?: string;
  status?: string;
  done?: boolean;
  level?: string;
  progress?: number;
  /** An action or decision's meeting or note, as a record id. */
  source?: string;
  /** A file in the project's folder on the PC: its path inside that folder. */
  folderFile?: string;
  /** An action written as a tick box in a note: the box's words as written (so a tick lands on its line). */
  task?: string;
  /** The record's fields as shown, in order. */
  facts: RecordFact[];
  /** A person or organisation: the other names it goes by. */
  names?: string[];
  /** A note of its own type (a Bill, a Machine, a Trip): the type's name, said instead of "Note". */
  kind?: string;
  /** It is a whole note of its own (a project, meeting, note, or a person or organisation with their page), or a file. */
  page?: boolean;
  mtime?: number;
}

export interface RecordLink {
  a: string;
  b: string;
  kind: LinkKind;
  /** The reason shown beside b on a's peek, and beside a on b's. */
  why: string;
  back: string;
}

export interface Neighbour {
  id: string;
  kinds: LinkKind[];
  whys: string[];
}

export interface RecordModel {
  records: Map<string, VaultRecord>;
  links: RecordLink[];
  adj: Map<string, Neighbour[]>;
  /** The records written in each note. */
  byPath: Map<string, string[]>;
  /** People by their name key (personKey). */
  people: Map<string, string>;
  /** Each project as read from its file, with its properties (the hub's rules run on it: projectNeeds). */
  projects: Map<string, { project: Project; props: Record<string, unknown> }>;
  today: string;
  me: string | null;
}

export interface RecordNoteInput {
  path: string;
  title: string;
  label?: string;
  content: string;
  props: Record<string, unknown>;
  mtime?: number;
}

export interface RecordModelInput {
  notes: RecordNoteInput[];
  /** The vault's files that aren't notes (pictures, PDFs, documents). */
  files?: string[];
  /** A link's words (from a note) to the note or file it reaches, or null. */
  resolve(target: string, from: string): string | null;
  /** YYYY-MM-DD; today when left out. */
  today?: string;
  /** Who "me" is (the person's own name); else the owner of most of the live projects (src/shared/today.ts whoIsMe). */
  me?: string | null;
  templatesFolder?: string;
}

// ── Small helpers ─────────────────────────────────────────────────────────────────────────────────────────────────────

const LINK_RE = /\[\[([^\]|#\n]+)(?:#[^\]|\n]*)?(?:\|([^\]\n]*))?\]\]/g;
const NOBODY = /^(?:unassigned|not assigned|no one|nobody|none|tbc|tbd|tba|n\/a|unknown|[-—–?]+)?$/i;
/** Between people named together ("Jesse with Jay Lu", "Sam and Mia", "Jay / team"). */
const PEOPLE_SPLIT = /\s*(?:,|&|\/|\band\b|\bwith\b|·|\+)\s*/;
const PLACEHOLDER = /^what needs doing\s*[—–-]+\s*who\s*[—–-]+\s*by when$/i;
const ORG_WORDS = /\b(b\.?v\.?|ltd|limited|pty|inc|llc|gmbh|plc|corp(oration)?|company|co\.|group|holdings|s\.?a\.?|ag|partners|services|solutions|systems|technologies|consulting|council|university|bank)\b/i;
const ORG_ROLE = /\b(vendor|supplier|contractor|provider|partner|client|customer|agency|company|carrier|manufacturer|reseller|distributor|landlord|consultancy)\b/i;
const ORG_TYPE = /^(org|organisation|organization|company|supplier|vendor|business|client|customer)$/i;
/** Small words with no matching substance, for every near-duplicate check (5 Nov 2026, v8-vault-assistant: reminders
 *  false-matched on "the"). The one list lives in stop-words.ts; records re-exports it for its own readers. */
export { STOP_WORDS } from './stop-words';

const plainSlow = (k: string): string =>
  k
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]|#]+)(?:#[^\]]*)?\]\]/g, (_m, t: string) => t.split('/').pop()!.replace(/\.md$/i, ''))
    .replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();

// The same short names cross again and again while a model builds (owners, titles, roles): kept, so the
// seven patterns run once per name, not once per record (t102, 9 Nov 2026). Pure, so clearing is only slow.
const plainMemo = new Map<string, string>();
const plain = (s: string): string => {
  const k = String(s ?? '');
  if (k.length > 240) return plainSlow(k);
  const had = plainMemo.get(k);
  if (had !== undefined) return had;
  const out = plainSlow(k);
  if (plainMemo.size > 4000) plainMemo.clear();
  plainMemo.set(k, out);
  return out;
};

/** A record's slug: its words in lower case, joined by dashes (stable while its words stay the same). */
export function slugOf(text: string): string {
  return (
    plain(text)
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64)
      .replace(/-+$/, '') || 'item'
  );
}

const orgSlug = (name: string) => slugOf(name.replace(/\b(b\.?v\.?|ltd\.?|limited|pty|inc\.?|llc|gmbh|plc)\b/gi, ''));
const titleOfPath = (p: string) => (p.split('/').pop() ?? p).replace(/\.(md|canvas)$/i, '');
const extOf = (p: string) => (/\.([^./\\]+)$/.exec(p)?.[1] ?? '').toLowerCase();
const folderOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

/** A person's other names from their note (9 Nov 2026, one person one page): aliases plus the known as list,
 *  however written. */
const KNOWN_AS_KEYS = new Set(['aliases', 'alias', 'known as', 'known_as', 'known-as', 'knownas', 'also known as', 'aka', 'nickname', 'nicknames']);
export function personAliases(props: Record<string, unknown>): string[] {
  const out: string[] = [];
  const push = (v: unknown): void => {
    if (v === null || v === undefined || v === '') return;
    if (Array.isArray(v)) {
      for (const x of v) push(x);
      return;
    }
    if (typeof v === 'string') {
      for (const s of v.split(',').map((s) => s.trim()).filter(Boolean)) if (!out.includes(s)) out.push(s);
      return;
    }
    const s = String(v).trim();
    if (s && !out.includes(s)) out.push(s);
  };
  for (const [k, v] of Object.entries(props ?? {})) if (KNOWN_AS_KEYS.has(k.trim().toLowerCase())) push(v);
  return out;
}

function isoOfWords(words: string | undefined, ref: Date): string | undefined {
  if (!words) return undefined;
  const t = plain(words).replace(/\(.*?\)/g, ' ').replace(/^(?:by|due|before|on)\s+/i, '').replace(/^(?:the\s+)?(?:week\s+of|w\/c|w\.c\.)\s+/i, '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  // "Fri 23 Oct, 11:00 AM AEDT": the day before its time.
  for (const c of [t.slice(0, 60), t.split(/,|\s+at\s+/)[0], t.split(/\s+/).slice(0, 3).join(' ')]) {
    const d = c && readDay(c, ref);
    if (d) return isoDay(d);
  }
  return undefined;
}

function frontEnd(lines: string[]): number {
  if (lines[0]?.trim() !== '---') return 0;
  const end = lines.findIndex((l, i) => i > 0 && /^(---|\.\.\.)\s*$/.test(l));
  if (end <= 0) return 0;
  // Only a properties-shaped block counts (9.2): a plain --- rule with tasks between rules is not front matter.
  const shaped = lines.slice(1, end).some((l) => /^[A-Za-z][\w -]*:\s/.test(l) || /^[A-Za-z][\w -]*:\s*$/.test(l));
  return shaped ? end + 1 : 0;
}

interface SectionLines {
  heading: string;
  /** The heading's line. */
  at: number;
  /** Its body's lines, each with its line in the file. */
  lines: { text: string; line: number }[];
}

function sectionsOf(content: string, level = 2): SectionLines[] {
  const lines = content.split(/\r?\n/);
  const out: SectionLines[] = [{ heading: '', at: -1, lines: [] }];
  let fence = false;
  const re = new RegExp(`^#{${level}}\\s+(.+?)\\s*#*\\s*$`);
  for (let i = frontEnd(lines); i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*(```|~~~)/.test(l)) fence = !fence;
    const h = !fence && re.exec(l);
    if (h) out.push({ heading: h[1].trim(), at: i, lines: [] });
    else out[out.length - 1].lines.push({ text: l, line: i });
  }
  return out;
}

function linksIn(text: string): string[] {
  return [...String(text ?? '').matchAll(LINK_RE)].map((m) => m[1].trim()).filter(Boolean);
}

function listWords(items: string[], max = 2): string {
  if (items.length <= 1) return items[0] ?? '';
  if (items.length <= max) return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
  return `${items.slice(0, max).join(', ')} and ${items.length - max} more`;
}

// ── Building the model ────────────────────────────────────────────────────────────────────────────────────────────────

class Builder {
  records = new Map<string, VaultRecord>();
  links: RecordLink[] = [];
  private linkKeys = new Set<string>();
  /** Pairs joined by something specific (never a generic link), either way round: pass 6 reads it instead of
   *  scanning every link per body link (5 Nov 2026, v5-vault-speed: the 7 s peek rebuild on a big vault). */
  private specificPairs = new Set<string>();
  /** Records something already owns (the b side of an owner link): pass 9b reads it instead of scanning. */
  private owned = new Set<string>();
  byPath = new Map<string, string[]>();
  people = new Map<string, string>();
  orgs = new Map<string, string>();
  ref: Date;

  constructor(
    readonly input: RecordModelInput,
    readonly today: string,
  ) {
    this.ref = readDay(today) ?? new Date();
  }

  add(r: VaultRecord): VaultRecord {
    // "Unassigned", "TBC", "—": no one yet.
    if (r.owner !== undefined && NOBODY.test(plain(r.owner))) r = { ...r, owner: undefined };
    let id = r.id;
    for (let n = 2; this.records.has(id); n++) id = `${r.id}~${n}`;
    const rec = { ...r, id };
    this.records.set(id, rec);
    const list = this.byPath.get(rec.path) ?? [];
    list.push(id);
    this.byPath.set(rec.path, list);
    return rec;
  }

  /** `toB` is the reason shown beside b on a's peek; `toA` beside a on b's (the same when left out). */
  link(a: string | undefined, b: string | undefined, kind: LinkKind, toB: string, toA: string = toB): void {
    if (!a || !b || a === b || !this.records.has(a) || !this.records.has(b)) return;
    // One undirected key (t102, 9 Nov 2026: two directed keys were built and looked up per candidate —
    // the same pairs kept, the pushed link still reads a to b).
    const key = a < b ? `${a}\n${b}\n${kind}` : `${b}\n${a}\n${kind}`;
    if (this.linkKeys.has(key)) return;
    this.linkKeys.add(key);
    this.links.push({ a, b, kind, why: toB, back: toA });
    if (kind !== 'link') this.specificPairs.add(a < b ? `${a}\n${b}` : `${b}\n${a}`);
    if (kind === 'owner') this.owned.add(b);
  }

  /** Whether the pair is joined by something specific (its project, its meeting, its owner…), never a generic link. */
  specificJoins(a: string, b: string): boolean {
    return this.specificPairs.has(a < b ? `${a}\n${b}` : `${b}\n${a}`);
  }

  /** Whether something already owns this record. */
  isOwned(id: string): boolean {
    return this.owned.has(id);
  }

  /** A person by name: the one known, else a new record written where they were first named. */
  person(raw: string, where?: { path: string; line?: number; project?: string }): string | undefined {
    const key = personKey(raw);
    if (!key) return undefined;
    const known = this.people.get(key);
    if (known) return known;
    if (!where) return undefined;
    const shown = plain(raw)
      .replace(/\([^)]*\)/g, ' ')
      .split(/\s+[—–-]\s+|[,;/|]/)[0]
      .replace(/\s+/g, ' ')
      .trim();
    const rec = this.add({ id: `person:${key}`, type: 'person', title: shown, path: where.path, line: where.line, facts: [], names: [shown] });
    this.people.set(key, rec.id);
    return rec.id;
  }

  org(name: string, where: { path: string; line?: number }, facts: RecordFact[] = []): string {
    const key = orgSlug(name);
    const known = this.orgs.get(key);
    if (known) return known;
    const rec = this.add({ id: `org:${key}`, type: 'org', title: plain(name), path: where.path, line: where.line, facts, names: [plain(name)] });
    this.orgs.set(key, rec.id);
    return rec.id;
  }
}

interface NoteKind {
  note: RecordNoteInput;
  kind: 'project' | 'person' | 'meeting' | 'org' | 'note';
  id: string;
  project?: Project;
}

/** Builds every record and link from the notes. */
export function buildRecordModel(input: RecordModelInput): RecordModel {
  const today = input.today ?? isoDay(new Date());
  const b = new Builder(input, today);
  const tpl = (input.templatesFolder ?? 'Templates').replace(/\/+$/, '');
  // The templates folder reads through the one folder check (5 Nov 2026, u3 moving-in: a lowercase templates/ note
  // counted here but nowhere else — one case rule, every door).
  const notes = input.notes.filter((n) => /\.md$/i.test(n.path) && !(tpl && (n.path.toLowerCase() === tpl.toLowerCase() || inFolder(n.path, tpl))));
  const kinds: NoteKind[] = [];

  // 1. The notes themselves: projects, people, meetings, organisations and other notes.
  for (const note of notes) {
    const props = note.props ?? {};
    const type = String(props.type ?? '').toLowerCase();
    const title = note.title || titleOfPath(note.path);
    if (isProjectProps(props)) {
      const p = parseProject(note.content, note.path);
      const rec = b.add({ id: `project:${note.path}`, type: 'project', title: p.name || title, path: note.path, line: 0, page: true, project: note.path, owner: p.owner, due: isoOfWords(p.due, b.ref), status: p.status, mtime: note.mtime, facts: [] });
      kinds.push({ note, kind: 'project', id: rec.id, project: p });
    } else if (ORG_TYPE.test(type)) {
      const key = orgSlug(title);
      const rec = b.add({ id: `org:${key}`, type: 'org', title, path: note.path, line: 0, page: true, mtime: note.mtime, facts: [], names: [title] });
      b.orgs.set(key, rec.id);
      kinds.push({ note, kind: 'org', id: rec.id });
    } else if (isPersonNote(note.path, props)) {
      // A note in People whose title is not a person's name is a note, not a person (10 Nov 2026 and a lone
      // "Maren" read as Person). An explicit type still wins: a note typed person with a single name stays
      // someone the person meant. The path alone never makes a code or a first name a person.
      const explicit = type === 'person' || type === 'people' || type === 'contact';
      const named = personKey(title);
      if (!named && !explicit) {
        const rec = b.add({ id: `note:${note.path}`, type: 'note', title: note.label || title, path: note.path, line: 0, page: true, mtime: note.mtime, facts: propFacts(props), ...(type && type !== 'note' ? { kind: type.replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase()) } : {}) });
        kinds.push({ note, kind: 'note', id: rec.id });
      } else {
        const key = named ?? `~${slugOf(title)}`;
        const aliases = personAliases(props);
        const rec = b.add({ id: `person:${key}`, type: 'person', title, path: note.path, line: 0, page: true, mtime: note.mtime, facts: [], names: [title, ...aliases] });
        for (const n of [title, ...aliases]) {
          const k = personKey(n);
          if (k && !b.people.has(k)) b.people.set(k, rec.id);
        }
        kinds.push({ note, kind: 'person', id: rec.id });
      }
    } else if (isMeetingNote(note.path, props)) {
      const rec = b.add({ id: `meeting:${note.path}`, type: 'meeting', title: (note.label && note.label !== title ? note.label : '') || title, path: note.path, line: 0, page: true, mtime: note.mtime, facts: [] });
      kinds.push({ note, kind: 'meeting', id: rec.id });
    } else {
      // A note of its own type (a module's Bill, Machine, Trip…) shows its fields, so it opens as itself (26 Oct 2026, the
      // owner: a bill opened as an empty "Note").
      const rec = b.add({ id: `note:${note.path}`, type: 'note', title: note.label || title, path: note.path, line: 0, page: true, mtime: note.mtime, facts: propFacts(props), ...(type && type !== 'note' ? { kind: type.replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase()) } : {}) });
      kinds.push({ note, kind: 'note', id: rec.id });
    }
  }
  const noteRecord = new Map(kinds.map((k) => [k.note.path, k.id]));
  const projectsByPath = new Map(kinds.filter((k) => k.kind === 'project').map((k) => [k.note.path, k]));
  const resolve = (target: string, from: string) => input.resolve(target, from);
  const recordOfTarget = (target: string, from: string): string | undefined => {
    const p = resolve(target, from);
    if (!p) return undefined;
    if (noteRecord.has(p)) return noteRecord.get(p);
    if (!/\.md$/i.test(p)) return fileRecord(p);
    return undefined;
  };
  const fileRecord = (p: string, project?: string): string => {
    const id = `file:${p}`;
    if (!b.records.has(id)) b.add({ id, type: 'file', title: p.split('/').pop() ?? p, path: p, page: true, project, facts: [{ key: 'kind', label: 'Kind', value: extOf(p).toUpperCase() || 'File' }, { key: 'where', label: 'In', value: folderOf(p) || 'The top of the vault' }] });
    else if (project && !b.records.get(id)!.project) b.records.get(id)!.project = project;
    return id;
  };

  // Which project each note belongs to: its `project` property, an owned project's folder, or the project file
  // naming it. Only an owned folder files (5 Nov 2026, u3 moving-in: a coincidental project file claimed its
  // folder); a note that merely links to one project is see-also there, never a member (5 Nov 2026,
  // v9-vault-truth: the page counted 77 tasks on an ordinary project). Worked out once per project, not once per note.
  const projectDirs = [...projectsByPath.keys()].filter(projectOwnsFolder).map((p) => ({ path: p, dir: folderOf(p) })).filter((x) => x.dir);
  const noteByPath = new Map(kinds.map((k) => [k.note.path, k.note]));
  const claimedBy = new Map<string, string[]>();
  for (const p of projectsByPath.keys()) {
    const content = noteByPath.get(p)?.content ?? '';
    for (const t of linksIn(content)) {
      const hit = resolve(t, p);
      if (!hit || hit === p) continue;
      const list = claimedBy.get(hit) ?? [];
      if (list[list.length - 1] !== p) claimedBy.set(hit, [...list, p]);
    }
  }
  const projectOf = (note: RecordNoteInput): string | undefined => {
    if (projectsByPath.has(note.path)) return note.path;
    const prop = note.props?.project ?? note.props?.projects;
    for (const v of Array.isArray(prop) ? prop : prop ? [prop] : []) {
      const t = String(v).replace(/^\[\[|\]\]$/g, '').split('|')[0].split('#')[0].trim();
      const p = t && resolve(t, note.path);
      if (p && projectsByPath.has(p)) return p;
    }
    const dir = projectDirs.filter((x) => note.path.startsWith(`${x.dir}/`)).sort((a, z) => z.dir.length - a.dir.length)[0];
    if (dir) return dir.path;
    const claimed = claimedBy.get(note.path) ?? [];
    return claimed.length === 1 ? claimed[0] : undefined;
  };
  const noteProject = new Map(kinds.map((k) => [k.note.path, projectOf(k.note)]));

  // 2. People and organisations first, so items can name them.
  for (const k of kinds.filter((x) => x.kind === 'person')) {
    const props = k.note.props ?? {};
    const rec = b.records.get(k.id)!;
    const role = str(props.role ?? props.title ?? props.position);
    const org = str(props.org ?? props.organisation ?? props.organization ?? props.company);
    const email = str(props.email);
    const phone = str(props.phone ?? props.mobile);
    if (role) rec.facts.push({ key: 'role', label: 'Role', value: role });
    if (org) {
      const oid = b.org(org, { path: k.note.path, line: 0 });
      rec.facts.push({ key: 'org', label: 'Organisation', value: plain(org), ref: oid });
      b.link(k.id, oid, 'org', 'Their organisation', 'Works here');
    }
    if (email) rec.facts.push({ key: 'email', label: 'Email', value: email });
    if (phone) rec.facts.push({ key: 'phone', label: 'Phone', value: phone });
  }
  for (const k of kinds.filter((x) => x.kind === 'project')) {
    const p = k.project!;
    const lines = k.note.content.split(/\r?\n/);
    for (const [i, person] of p.people.entries()) {
      const at = findLine(lines, person.name, 'people');
      for (const name of splitNames(person.name)) {
        if (isOrgName(name, person.role)) b.org(name, { path: k.note.path, line: at }, person.role ? [{ key: 'role', label: 'What they do', value: plain(person.role) }] : []);
        else b.person(name, { path: k.note.path, line: at, project: k.note.path });
      }
      void i;
    }
    if (p.owner) b.person(p.owner, { path: k.note.path, line: 0 });
  }

  // 3. Each project's own records.
  for (const k of kinds.filter((x) => x.kind === 'project')) readProjectRecords(b, k, resolve, recordOfTarget, fileRecord);

  // 4. Meetings: their day, attendees, project, actions and decisions.
  for (const k of kinds.filter((x) => x.kind === 'meeting')) {
    const props = k.note.props ?? {};
    const rec = b.records.get(k.id)!;
    const project = noteProject.get(k.note.path);
    rec.project = project;
    const day = calendarDayOf(props.date ?? props.when ?? props.day) ?? isoOfWords(str(props.date ?? props.when ?? props.day), b.ref) ?? /(\d{4}-\d{2}-\d{2})/.exec(k.note.path.split('/').pop() ?? '')?.[1];
    if (day) {
      rec.date = day;
      rec.facts.push({ key: 'date', label: 'Day', value: day });
    }
    const time = str(props.time ?? props.start);
    if (time) rec.facts.push({ key: 'time', label: 'Time', value: time });
    if (project) {
      rec.facts.push({ key: 'project', label: 'Project', value: b.records.get(`project:${project}`)?.title ?? titleOfPath(project), ref: `project:${project}` });
      b.link(k.id, `project:${project}`, 'project', 'Its project', 'Meeting');
    }
    const who = attendeesOf(k.note.content, props);
    const ids: string[] = [];
    for (const name of who) {
      const id = b.person(name) ?? (personKey(name) ? b.person(name, { path: k.note.path, line: 0, project }) : undefined);
      if (id && !ids.includes(id)) ids.push(id);
    }
    if (ids.length) rec.facts.push({ key: 'attendees', label: 'Attendees', value: ids.map((i) => b.records.get(i)!.title).join(', '), refs: ids.map((i) => ({ id: i, name: b.records.get(i)!.title })) });
    for (const id of ids) b.link(id, k.id, 'attendee', 'Attended', 'Attendee');
    readNoteItems(b, k, project, recordOfTarget);
    readMeetingDecisions(b, k, project);
  }

  // 5. People's own notes and other notes: their task lines, and the project they belong to.
  for (const k of kinds.filter((x) => x.kind === 'person' || x.kind === 'note' || x.kind === 'org')) {
    const project = k.kind === 'note' ? noteProject.get(k.note.path) : undefined;
    const rec = b.records.get(k.id)!;
    if (project) {
      rec.project = project;
      b.link(k.id, `project:${project}`, 'project', 'Its project', 'Note');
    }
    // An email's sender (t243, 12 Nov 2026): the sender prop's person joins, so the email reads on their
    // card (front matter never links as body links do — meetings join their attendees the same specific way).
    if (k.kind === 'note') {
      const sender = k.note.props?.sender;
      for (const raw of Array.isArray(sender) ? sender : sender ? [sender] : []) {
        const target = String(raw).replace(/^\[\[|\]\]$/g, '').split('|')[0].split('#')[0].trim();
        if (!target) continue;
        const to = recordOfTarget(target, k.note.path);
        const known = to && (b.records.get(to)?.type === 'person' || b.records.get(to)?.type === 'org') ? to : undefined;
        const person = known ?? (personKey(target) ? b.person(target, { path: k.note.path, line: 0, project }) : undefined);
        if (person) b.link(k.id, person, 'contact', 'Sent by', 'Sent it');
      }
    }
    readNoteItems(b, k, project, recordOfTarget);
  }

  // 6. Links between notes, and the files they name; people named by link anywhere.
  for (const k of kinds) {
    const lines = k.note.content.split(/\r?\n/);
    const front = frontEnd(lines);
    for (const [i, l] of lines.entries()) {
      if (i < front) continue;
      for (const m of l.matchAll(LINK_RE)) {
        const target = m[1].trim();
        const to = recordOfTarget(target, k.note.path);
        if (!to) continue;
        const kind: LinkKind = to.startsWith('file:') ? 'file' : 'link';
        const toRec = b.records.get(to)!;
        if (kind === 'file' && !toRec.project && noteProject.get(k.note.path)) toRec.project = noteProject.get(k.note.path);
        // One pair reads once (p17-connected, 4 Nov 2026): a specific join (its project, its meeting, its
        // owner) beats a generic link, so a meeting of a project says "Meeting", not "Meeting · Links
        // here". Properties above are already read specifically (project, attendees), never as body links.
        if (kind === 'link' && b.specificJoins(k.id, to)) continue;
        b.link(k.id, to, kind, kind === 'file' ? 'Named here' : 'Linked from here', kind === 'file' ? 'Names it' : 'Links here');
        // An item on this line links onward too.
        for (const item of itemsOnLine(b, k.note.path, i)) {
          if (item === k.id) continue;
          const itemKind: LinkKind = to.startsWith('meeting:') ? 'source' : kind;
          if (itemKind === 'link' && b.specificJoins(item, to)) continue;
          b.link(item, to, itemKind, to.startsWith('meeting:') ? 'Its meeting' : kind === 'file' ? 'Named in it' : 'Linked from it', to.startsWith('meeting:') ? 'Links to this meeting' : kind === 'file' ? 'Names it' : 'Links here');
        }
      }
    }
  }

  // 7. Files a project keeps in its folder in the vault.
  for (const f of input.files ?? []) {
    const dir = projectDirs.filter((x) => f.startsWith(`${x.dir}/`)).sort((a, z) => z.dir.length - a.dir.length)[0];
    if (!dir || /\.(canvas|json)$/i.test(f)) continue;
    const id = fileRecord(f, dir.path);
    b.link(id, `project:${dir.path}`, 'project', 'Its project', 'File');
  }
  for (const r of b.records.values()) if (r.type === 'file' && r.project) b.link(r.id, `project:${r.project}`, 'project', 'Its project', 'File');

  // 8. Things of one project about the same thing, and a key date on a meeting's day.
  // Grouped once (t102, 9 Nov 2026: each project scanned every record — the same items, the same order).
  const itemsByProject = new Map<string, VaultRecord[]>();
  for (const r of b.records.values()) {
    if (!r.project || !['action', 'milestone', 'workstream', 'risk', 'decision', 'meeting'].includes(r.type)) continue;
    const list = itemsByProject.get(r.project) ?? [];
    list.push(r);
    itemsByProject.set(r.project, list);
  }
  for (const k of kinds.filter((x) => x.kind === 'project')) {
    const items = itemsByProject.get(k.note.path) ?? [];
    aboutLinks(b, items, k.project!);
    for (const m of items.filter((r) => r.type === 'meeting' && r.date))
      for (const d of items.filter((r) => r.type === 'milestone' && r.date === m.date)) b.link(d.id, m.id, 'same-day', 'Same day');
  }

  // 9. Actions filed from a meeting into a project: the project's line comes from the meeting's.
  const meetingActions = [...b.records.values()].filter((r) => r.type === 'action' && r.source?.startsWith('meeting:'));
  const projectActions = [...b.records.values()].filter((r) => r.type === 'action' && !r.source?.startsWith('meeting:'));
  // Each action's comparing words once (t102, 9 Nov 2026: the pair loop below worked them out per pair —
  // hundreds of thousands of pairs on a big vault, each with a dozen regexes; the same pairs, the same order).
  const whatOf = new Map<string, string>();
  const what = (r: VaultRecord): string => {
    let w = whatOf.get(r.id);
    if (w === undefined) {
      w = sameWhat(r.title);
      whatOf.set(r.id, w);
    }
    return w;
  };
  const ownerPartsOf = new Map<string, { key: string | null; low: string }>();
  const ownerParts = (r: VaultRecord): { key: string | null; low: string } => {
    let p = ownerPartsOf.get(r.id);
    if (!p) {
      p = { key: personKey(plain(r.owner ?? '')), low: plain(r.owner ?? '').toLowerCase() };
      ownerPartsOf.set(r.id, p);
    }
    return p;
  };
  const ownersAgreeBy = (m: VaultRecord, a: VaultRecord): boolean => {
    if (!m.owner?.trim() || !a.owner?.trim()) return true;
    const x = ownerParts(m);
    const y = ownerParts(a);
    if (x.key && y.key) return x.key === y.key;
    return x.low === y.low;
  };
  // Only its own project's actions can file (a different project never reaches an effect below).
  const projectActionsByProject = new Map<string, VaultRecord[]>();
  for (const a of projectActions) {
    if (!a.project) continue;
    const list = projectActionsByProject.get(a.project) ?? [];
    list.push(a);
    projectActionsByProject.set(a.project, list);
  }
  const filePair = (m: VaultRecord, a: VaultRecord) => {
    if (!a.source) a.source = m.source;
    b.link(a.id, m.source, 'source', 'Its meeting', 'Filed in a project');
    b.link(a.id, m.id, 'source', `The same action, in ${b.records.get(m.source ?? '')?.title ?? 'the meeting'}`, 'The same action, filed in the project');
  };
  const byWords = new Map<string, VaultRecord[]>();
  for (const a of projectActions) {
    const key = what(a);
    if (!key) continue;
    const list = byWords.get(key) ?? [];
    list.push(a);
    byWords.set(key, list);
  }
  for (const m of meetingActions) for (const a of byWords.get(what(m)) ?? []) filePair(m, a);
  // The same deed reworded files too (5 Nov 2026, v8-vault-assistant: one deed listed twice): the same subject,
  // the same project, owners agreeing (one side unnamed counts as agreeing). A joint chase never files into a split
  // follow-up: more words, or another owner.
  for (const m of meetingActions) {
    if (!m.project) continue;
    const wm = what(m);
    for (const a of projectActionsByProject.get(m.project) ?? []) {
      if (what(a) === wm) continue;
      if (!sameSubject(m.title, a.title) || !ownersAgreeBy(m, a)) continue;
      filePair(m, a);
    }
  }

  // 9b. Someone named only as who does a step, a workstream or a risk ("— Thad Vance") is a person too (Wave 4, 24 Oct 2026:
  //     People and Organisations' cards list what is theirs, and "12 people named in your projects" counts them), joined
  //     as its owner. A group or a role ("Shift leads", "Jay and team") is never one (relations.ts personKey).
  for (const r of [...b.records.values()]) {
    if (!r.owner || !['action', 'workstream', 'risk'].includes(r.type)) continue;
    if (b.isOwned(r.id)) continue;
    for (const part of plain(r.owner).replace(/\([^)]*\)/g, ' ').split(PEOPLE_SPLIT)) {
      const pid = part && (b.person(part) ?? (personKey(part) && !isOrgName(part, '') ? b.person(part, { path: r.path, line: r.line, project: r.project }) : undefined));
      if (pid) b.link(pid, r.id, 'owner', ownsWords(r.type), 'Owner');
    }
  }

  // 9c. Copies that differ only by a copy marker (“No. 3 …” and “No. 3 … 2”) say so on both (9.2).
  {
    // Grouped by folder first (5 Nov 2026, v5-vault-speed): copies only ever sit beside each other, so pairs
    // across folders are never compared; each title lowered once, not per pair. Looked up by title (t102,
    // 9 Nov 2026): a big folder compared every pair — the same pairs, each record's in its group order.
    const pages = [...b.records.values()].filter((r) => r.page);
    const lowered = new Map<string, string>();
    const titleOf = (r: VaultRecord): string => {
      let t = lowered.get(r.id);
      if (t === undefined) {
        t = plain(r.title).toLowerCase();
        lowered.set(r.id, t);
      }
      return t;
    };
    const byFolder = new Map<string, VaultRecord[]>();
    for (const r of pages) {
      const f = folderOf(r.path);
      const list = byFolder.get(f) ?? [];
      list.push(r);
      byFolder.set(f, list);
    }
    for (const group of byFolder.values()) {
      const byTitle = new Map<string, VaultRecord[]>();
      const at = new Map<string, number>();
      for (const [i, r] of group.entries()) {
        at.set(r.id, i);
        const t = titleOf(r);
        const list = byTitle.get(t) ?? [];
        list.push(r);
        byTitle.set(t, list);
      }
      for (const r of group) {
        const a = titleOf(r);
        const cands = [...(byTitle.get(`${a} 2`) ?? []), ...(byTitle.get(`${a} copy`) ?? [])];
        const base = a.endsWith(' 2') ? a.slice(0, -2) : a.endsWith(' copy') ? a.slice(0, -5) : null;
        if (base !== null) cands.push(...(byTitle.get(base) ?? []));
        cands.sort((x, y) => at.get(x.id)! - at.get(y.id)!);
        for (const o of cands) {
          if (o === r) continue;
          if (!r.facts.some((f) => f.key === 'duplicate' && f.ref === o.id)) r.facts.push({ key: 'duplicate', label: 'Possible duplicate of', value: o.title, ref: o.id });
        }
      }
    }
  }

  // 10. Facts that name records become links in the peek.
  for (const r of b.records.values()) {
    if (r.owner && !r.facts.some((f) => f.key === 'owner')) {
      const pid = b.person(r.owner);
      r.facts.unshift({ key: 'owner', label: r.type === 'project' ? 'Owner' : 'Who', value: plain(r.owner), ...(pid ? { ref: pid } : {}) });
    }
    if (r.source && !r.facts.some((f) => f.key === 'source')) r.facts.push({ key: 'source', label: 'From', value: b.records.get(r.source)?.title ?? r.source, ref: r.source });
    if (r.project && r.type !== 'project' && r.type !== 'meeting' && !r.facts.some((f) => f.key === 'project')) r.facts.push({ key: 'project', label: 'Project', value: b.records.get(`project:${r.project}`)?.title ?? titleOfPath(r.project), ref: `project:${r.project}` });
  }

  const adj = new Map<string, Neighbour[]>();
  const push = (from: string, to: string, kind: LinkKind, why: string) => {
    const list = adj.get(from) ?? [];
    let n = list.find((x) => x.id === to);
    if (!n) {
      n = { id: to, kinds: [], whys: [] };
      list.push(n);
    }
    if (!n.kinds.includes(kind)) n.kinds.push(kind);
    if (why && !n.whys.includes(why)) n.whys.push(why);
    adj.set(from, list);
  };
  for (const l of b.links) {
    push(l.a, l.b, l.kind, l.why);
    push(l.b, l.a, l.kind, l.back);
  }
  const me = input.me?.trim() || whoIsMe(kinds.filter((k) => k.project).map((k) => k.project!)) || null;
  const projects = new Map(kinds.filter((k) => k.project).map((k) => [k.note.path, { project: k.project!, props: k.note.props ?? {} }]));
  const model: RecordModel = { records: b.records, links: b.links, adj, byPath: b.byPath, people: b.people, projects, today, me };
  // Each project's own late steps, the hub's way with its connected actions (p10-vault-connected C3/C4):
  // Connected and Home weigh the same health from the same late count.
  try {
    const todayDay = readTimelineDay(today) ?? readTimelineDay(isoDay(new Date()))!;
    for (const [pPath, { project, props }] of projects) {
      const rec = b.records.get(`project:${pPath}`);
      if (!rec) continue;
      const hub = hubModel({ project, props, today: todayDay, ...(me ? { me } : {}), connected: connectedActions(model, pPath) });
      rec.lateMine = hub.plan.late.length;
    }
  } catch {
    // Late counts are a convenience; the health still reads from the file.
  }
  return model;
}

/** An action's when as a fact: "By Fri 30 Oct"; a day it was asked for ("Requested 13 Oct") is when it was asked, not a due day. */
function whenFact(when: string): RecordFact {
  const asked = /^\s*(requested|asked|sent|chased|emailed|raised|ordered|submitted)\b\s*(?:on\s+)?(.*)$/i.exec(plain(when));
  return asked ? { key: 'when', label: 'Asked', value: asked[2] || plain(when) } : { key: 'when', label: 'By', value: plain(when) };
}

/** What a person's owning something is called, beside it on their peek. */
function ownsWords(type: RecordType): string {
  return type === 'action' ? 'Theirs to do' : type === 'workstream' ? 'They lead it' : type === 'risk' ? 'They own it' : type === 'project' ? 'Their project' : 'Theirs';
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : Array.isArray(v) ? v.map(String).join(', ') : '');

function splitNames(name: string): string[] {
  const t = plain(name).replace(/\([^)]*\)/g, ' ');
  if (isOrgName(t)) return [t.trim()];
  return t
    .split(/\s*(?:,|&|\band\b)\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function isOrgName(name: string, role = ''): boolean {
  return ORG_WORDS.test(name) || (ORG_ROLE.test(role) && !personKey(name));
}

/** The line in a file that holds an item (the first after its section's heading that has its words). */
function findLine(lines: string[], words: string, near?: string): number | undefined {
  const needle = plain(words).toLowerCase().slice(0, 48);
  if (!needle) return undefined;
  let from = 0;
  if (near) {
    const h = lines.findIndex((l) => new RegExp(`^##\\s+.*${near}`, 'i').test(l));
    if (h >= 0) from = h;
  }
  for (let i = from; i < lines.length; i++) if (plain(lines[i]).toLowerCase().includes(needle)) return i;
  for (let i = 0; i < from; i++) if (plain(lines[i]).toLowerCase().includes(needle)) return i;
  return undefined;
}

function itemsOnLine(b: Builder, path: string, line: number): string[] {
  return (b.byPath.get(path) ?? []).filter((id) => {
    const r = b.records.get(id)!;
    return r.line === line && r.type !== 'person' && r.type !== 'org' && r.type !== 'file' && r.type !== 'project' && r.type !== 'meeting' && r.type !== 'note';
  });
}

/** The people a meeting names: its attendees properties, its "Who came:" line, and "Who is invited:". */
function attendeesOf(content: string, props: Record<string, unknown>): string[] {
  const out = new Set(notePeople(content, props));
  const invited = /^\s*(?:\*\*)?(?:who is invited|who's invited|invited|invitees|participants|people)(?:\*\*)?\s*:?\s*(?:\*\*)?\s*:?\s*(.+)$/im.exec(content);
  if (invited)
    for (const x of plain(invited[1])
      .replace(/\([^)]*\)/g, ' ')
      .split(/\s*(?:,|;|\band\b|&|\.)\s*/))
      if (/^[A-Z][\p{L}'’-]+(?:\s+[A-Z][\p{L}'’-]+){1,2}$/u.test(x.trim())) out.add(x.trim());
  return [...out];
}

/** People named in some words: the people known (full names), and a first or last name only one person of the project
 *  has ("Lee" is Alex Lee when no other Lee is known there; Nov 2026 audit). A name two people could have never maps. */
function peopleNamed(b: Builder, words: string, local: string[]): string[] {
  const out: string[] = [];
  const text = ` ${plain(words).toLowerCase().replace(/[^\p{L}\s'-]/gu, ' ').replace(/\s+/g, ' ')} `;
  for (const [key, id] of b.people) if (text.includes(` ${key} `) && !out.includes(id)) out.push(id);
  const firsts = new Map<string, string[]>();
  const lasts = new Map<string, string[]>();
  for (const id of local) {
    const r = b.records.get(id);
    const parts = personKey(r?.title ?? '')?.split(' ');
    if (!parts) continue;
    firsts.set(parts[0], [...new Set([...(firsts.get(parts[0]) ?? []), id])]);
    lasts.set(parts[parts.length - 1], [...new Set([...(lasts.get(parts[parts.length - 1]) ?? []), id])]);
  }
  // A bare name maps only when every person it could be is one person (a first name of one and a last of another maps to neither).
  const hits = new Map<string, Set<string>>();
  for (const [token, ids] of [...firsts, ...lasts]) {
    if (!text.includes(` ${token} `)) continue;
    for (const id of ids) {
      if (!hits.has(token)) hits.set(token, new Set());
      hits.get(token)!.add(id);
    }
  }
  for (const ids of hits.values()) if (ids.size === 1) for (const id of ids) if (!out.includes(id)) out.push(id);
  return out;
}

function readProjectRecords(b: Builder, k: NoteKind, _resolve: (t: string, f: string) => string | null, recordOfTarget: (t: string, f: string) => string | undefined, fileRecord: (p: string, project?: string) => string): void {
  const p = k.project!;
  const path = k.note.path;
  const pid = k.id;
  const prec = b.records.get(pid)!;
  const lines = k.note.content.split(/\r?\n/);
  const today = b.today;
  // The project's facts.
  if (p.status) prec.facts.push({ key: 'status', label: 'Status', value: p.status });
  if (p.health) prec.facts.push({ key: 'health', label: 'Health', value: p.health });
  if (p.progress !== undefined) {
    prec.progress = p.progress;
    prec.facts.push({ key: 'progress', label: 'Progress', value: `${p.progress}%` });
  }
  if (p.due) prec.facts.push({ key: 'due', label: 'Due', value: p.due });
  const phase = str(k.note.props?.phase ?? k.note.props?.stage);
  if (phase) prec.facts.push({ key: 'phase', label: 'Phase', value: phase });
  if (p.owner) {
    const o = b.person(p.owner);
    b.link(o, pid, 'owner', 'Their project', 'Owner');
  }
  // Everyone the project knows, for first names.
  const local: string[] = [];
  const known = (id: string | undefined) => id && !local.includes(id) && local.push(id);
  for (const person of p.people) for (const n of splitNames(person.name)) known(b.person(n) ?? b.orgs.get(orgSlug(n)));
  if (p.owner) known(b.person(p.owner));
  const whoOf = (who: string | undefined): string[] => {
    if (!who) return [];
    const ids: string[] = [];
    for (const part of plain(who).replace(/\([^)]*\)/g, ' ').split(PEOPLE_SPLIT)) {
      const id = b.person(part) ?? peopleNamed(b, part, local).find((x) => x.startsWith('person:'));
      if (id && !ids.includes(id)) ids.push(id);
    }
    return ids;
  };
  const linkPeople = (id: string, words: string, owner?: string) => {
    const owners = whoOf(owner);
    for (const o of owners) b.link(o, id, 'owner', ownsWords(b.records.get(id)!.type), 'Owner');
    for (const m of peopleNamed(b, words, local)) if (!owners.includes(m)) b.link(id, m, 'mentions', 'Named in it', 'Names them');
  };
  /** The project's people by name, so a step's bare first or last name reads as who (Nov 2026 audit). */
  const localTitles = (): string[] => local.map((id) => b.records.get(id)).filter((r): r is VaultRecord => r?.type === 'person').map((r) => r.title);
  // Both ways carry words (p10-vault-connected C1, 4 Nov 2026): the project says what each thing is, so
  // its rows read how they join it.
  const inProject = (id: string) => {
    const t = b.records.get(id)?.type;
    const back = t === 'workstream' ? 'Workstream' : t === 'action' ? 'Action' : t === 'milestone' ? 'Key date' : t === 'risk' ? 'Risk' : t === 'decision' ? 'Decision' : 'In this project';
    b.link(id, pid, 'project', 'Its project', back);
  };

  // People and organisations of the project.
  for (const person of p.people) {
    const at = findLine(lines, person.name, 'people');
    for (const n of splitNames(person.name)) {
      const id = isOrgName(n, person.role) ? b.orgs.get(orgSlug(n)) : b.person(n);
      if (!id) continue;
      b.link(id, pid, 'contact', person.role ? plain(person.role).slice(0, 90) : 'In the project’s People');
      const rec = b.records.get(id)!;
      if (rec.path === path && rec.line === undefined) rec.line = at;
      if (person.role && !rec.facts.some((f) => f.key === 'role')) rec.facts.push({ key: 'role', label: 'Role', value: plain(person.role) });
    }
  }

  // Sections the model reads by their own lines.
  for (const s of sectionsOf(k.note.content)) {
    const body = s.lines.map((l) => l.text).join('\n');
    const head = s.heading;
    // A contacts table: Name / Role / Company / Contact.
    const t = /\|/.test(body) ? readTable(body) : null;
    const rowLines = t ? s.lines.filter((l) => /^\s*\|.*\|\s*$/.test(l.text)).slice(2) : [];
    if (t && t.head.length && /^(name|contact|who)$/i.test(t.head[0].trim())) {
      const roleCol = t.head.findIndex((h) => /^(role|title|what)$/i.test(h.trim()));
      const coCol = t.head.findIndex((h) => /^(company|org|organisation|organization|business)$/i.test(h.trim()));
      t.rows.forEach((row, i) => {
        const name = row[0]?.trim();
        if (!name) return;
        const at = rowLines.filter((l) => !/^\s*\|[\s:|-]+\|\s*$/.test(l.text))[i]?.line;
        const role = roleCol >= 0 ? row[roleCol]?.trim() : '';
        const id = isOrgName(name, role) ? b.org(name, { path, line: at }) : b.person(name, { path, line: at, project: path });
        if (!id) return;
        known(id);
        b.link(id, pid, 'contact', role || `In ${head}`);
        const co = coCol >= 0 ? row[coCol]?.trim() : '';
        if (co && id.startsWith('person:')) {
          const oid = b.org(co, { path, line: at });
          b.link(id, oid, 'org', 'Their organisation', 'Works here');
          b.link(oid, pid, 'contact', `In ${head}`);
        }
      });
    }
    // A workstreams table.
    if (t && t.head.length && (/^work\s*streams?$/i.test(head) || /^(work\s*stream|stream)s?$/i.test(t.head[0].trim()))) {
      const col = (re: RegExp) => t.head.findIndex((h) => re.test(h.trim()));
      const cOwner = col(/^(owner|lead|who)$/i);
      const cStatus = col(/^status$/i);
      const cProg = col(/^progress|%$/i);
      const cNext = col(/^(next step|next|next action)$/i);
      const dataLines = rowLines.filter((l) => !/^\s*\|[\s:|-]+\|\s*$/.test(l.text));
      t.rows.forEach((row, i) => {
        const name = plain(row[0] ?? '');
        if (!name) return;
        const owner = cOwner >= 0 ? row[cOwner]?.trim() : '';
        const status = cStatus >= 0 ? row[cStatus]?.trim() : '';
        const prog = cProg >= 0 ? Number(String(row[cProg] ?? '').replace(/%/, '')) : NaN;
        const next = cNext >= 0 ? row[cNext]?.trim() : '';
        const facts: RecordFact[] = [];
        if (status) facts.push({ key: 'status', label: 'Status', value: status });
        if (Number.isFinite(prog) && String(row[cProg] ?? '').trim()) facts.push({ key: 'progress', label: 'Progress', value: `${prog}%` });
        if (next) facts.push({ key: 'next', label: 'Next step', value: plain(next) });
        const rec = b.add({ id: `workstream:${path}#${slugOf(name)}`, type: 'workstream', title: name, path, line: dataLines[i]?.line, project: path, owner: owner || undefined, status: status || undefined, done: /\b(done|complete|completed|closed|finished)\b/i.test(status), ...(Number.isFinite(prog) && String(row[cProg] ?? '').trim() ? { progress: prog } : {}), facts });
        inProject(rec.id);
        linkPeople(rec.id, `${name} ${next}`, owner);
      });
    }
    // Tick boxes anywhere in the project (What's next, a run sheet's phases): its actions.
    if (!/^(notes|merged from)/i.test(head)) {
      let phase = '';
      for (const l of s.lines) {
        const h3 = /^###\s+(.+?)\s*#*\s*$/.exec(l.text);
        if (h3) phase = h3[1];
        const box = /^\s*[-*+]\s+\[([^\]])\]\s+(.*)$/.exec(l.text);
        if (!box) continue;
        const parts = actionParts(box[2], localTitles(), b.ref, true);
        const what = parts.what;
        if (!what || PLACEHOLDER.test(what)) continue;
        const done = box[1] !== ' ';
        const due = isoOfWords(parts.when, b.ref);
        const nextIndex = /^what.?s next$/i.test(head.replace(/[’']/g, "'")) ? p.next.findIndex((n) => plain(n.what) === plain(itemParts(box[2]).what) || slugOf(n.what) === slugOf(what)) : -1;
        const facts: RecordFact[] = [];
        facts.push({ key: 'status', label: 'Status', value: done ? 'Done' : due && due < today ? 'Overdue' : 'Open' });
        if (parts.when) facts.push(whenFact(parts.when));
        if (phase) facts.push({ key: 'phase', label: 'Phase', value: phase });
        else if (head && !/^what.?s next$/i.test(head.replace(/[’']/g, "'"))) facts.push({ key: 'section', label: 'Section', value: head });
        const rec = b.add({ id: `action:${path}#${slugOf(what)}`, type: 'action', title: what, path, line: l.line, project: path, owner: parts.who || undefined, done, due, when: parts.when || undefined, status: done ? 'done' : 'open', task: box[2], ...(nextIndex >= 0 ? { item: `next:${nextIndex}` } : {}), facts });
        inProject(rec.id);
        linkPeople(rec.id, what, parts.who);
      }
    }
  }

  // Key dates.
  p.dates.forEach((d, i) => {
    const date = isoOfWords(d.when, b.ref);
    const facts: RecordFact[] = [{ key: 'date', label: 'Day', value: d.when }];
    if (d.status) facts.push({ key: 'status', label: 'Status', value: d.status });
    const rec = b.add({ id: `milestone:${path}#${slugOf(d.what)}`, type: 'milestone', title: plain(d.what), path, line: findLine(lines, d.what, 'key dates'), project: path, date, when: d.when, status: d.status, done: /\b(done|complete|completed|met|passed|held)\b/i.test(d.status ?? ''), item: `dates:${i}`, facts });
    inProject(rec.id);
    linkPeople(rec.id, d.what);
  });
  // Risks and issues.
  p.risks.forEach((r, i) => {
    const facts: RecordFact[] = [];
    if (r.level) facts.push({ key: 'level', label: 'Impact', value: r.level });
    if (r.status) facts.push({ key: 'status', label: 'Status', value: r.status });
    else facts.push({ key: 'status', label: 'Status', value: r.closed ? `Closed${r.closedOn ? ` ${r.closedOn}` : ''}` : 'Open' });
    const rec = b.add({ id: `risk:${path}#${slugOf(r.what)}`, type: 'risk', title: plain(r.what), path, line: findLine(lines, r.what, 'risk'), project: path, owner: r.owner || undefined, level: r.level, status: r.status ?? (r.closed ? 'closed' : 'open'), done: !!r.closed, item: `risks:${i}`, facts });
    inProject(rec.id);
    linkPeople(rec.id, r.what, r.owner);
  });
  // Decisions.
  p.decisions.forEach((d, i) => {
    const date = isoOfWords(d.date, b.ref);
    const facts: RecordFact[] = [];
    if (d.date) facts.push({ key: 'date', label: 'Day', value: d.date });
    if (d.why) facts.push({ key: 'why', label: 'Why', value: plain(d.why) });
    const rec = b.add({ id: `decision:${path}#${slugOf(d.what)}`, type: 'decision', title: plain(d.what), path, line: findLine(lines, d.what, 'decision'), project: path, date, item: `decisions:${i}`, facts });
    inProject(rec.id);
    linkPeople(rec.id, `${d.what} ${d.why ?? ''}`);
  });
  // Documents: a link to a note or file, or a file in the project's folder on the PC.
  p.documents.forEach((d) => {
    const at = findLine(lines, d.link ?? d.path, 'documents');
    if (d.link) {
      for (const t of linksIn(d.link)) {
        const id = recordOfTarget(t, path);
        if (id) b.link(pid, id, id.startsWith('file:') ? 'file' : 'link', d.what ? plain(d.what).slice(0, 90) : 'In its documents', 'In the project’s documents');
      }
      return;
    }
    const rel = d.path.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!/\.[a-z0-9]{2,5}$/i.test(rel)) return;
    const id = `file:${path}::${rel}`;
    if (!b.records.has(id)) {
      const facts: RecordFact[] = [{ key: 'kind', label: 'Kind', value: extOf(rel).toUpperCase() || 'File' }, { key: 'where', label: 'In', value: `The project’s folder${folderOf(rel) ? ` › ${folderOf(rel).replace(/\//g, ' › ')}` : ''}` }];
      if (d.what) facts.push({ key: 'what', label: 'What it is', value: plain(d.what) });
      b.add({ id, type: 'file', title: rel.split('/').pop() ?? rel, path, line: at, project: path, folderFile: rel, facts });
    }
    b.link(id, pid, 'project', 'Its project', 'File');
    // A document named after a meeting's day or a workstream's words joins them through "about" below.
    void fileRecord;
  });
}

/** Task lines and actions in a meeting, a person's note or any note. */
function readNoteItems(b: Builder, k: NoteKind, project: string | undefined, recordOfTarget: (t: string, f: string) => string | undefined): void {
  const content = k.note.content;
  if (!/\[[^\]]\]/.test(content) && k.kind !== 'meeting') return;
  const isMeeting = k.kind === 'meeting';
  const people = [...b.people.keys()].map((key) => b.records.get(b.people.get(key)!)!.title);
  const seen = new Set<number>();
  const local: string[] = [];
  if (k.kind === 'person') local.push(k.id);
  const add = (line: number, text: string, done: boolean, who?: string, when?: string, due?: string | null, task?: string) => {
    const what = plain(text.replace(FILED_MARK, ''));
    if (!what || PLACEHOLDER.test(what) || seen.has(line)) return;
    seen.add(line);
    const iso = due ?? isoOfWords(when, b.ref);
    const facts: RecordFact[] = [{ key: 'status', label: 'Status', value: done ? 'Done' : iso && iso < b.today ? 'Overdue' : 'Open' }];
    if (when) facts.push(whenFact(when));
    const rec = b.add({ id: `action:${k.note.path}#${slugOf(what)}`, type: 'action', title: what, path: k.note.path, line, project, owner: who || undefined, done, due: iso || undefined, when: when || undefined, status: done ? 'done' : 'open', source: k.kind === 'meeting' || k.kind === 'note' ? k.id : undefined, ...(task !== undefined ? { task } : {}), facts });
    if (k.kind === 'meeting') b.link(rec.id, k.id, 'source', 'Its meeting', 'From this meeting');
    else if (k.kind === 'note') b.link(rec.id, k.id, 'source', 'Where it’s written', 'Written here');
    else b.link(rec.id, k.id, k.kind === 'person' ? 'mentions' : 'link', 'In their note', 'In their note');
    if (project) b.link(rec.id, `project:${project}`, 'project', 'Its project', k.kind === 'meeting' ? 'From a meeting' : 'From a note');
    const filed = FILED_MARK.exec(text);
    if (filed) {
      const to = recordOfTarget(filed[1].trim(), k.note.path);
      if (to) b.link(rec.id, to, 'project', 'Filed in the project', 'Filed here from a meeting');
    }
    const owners: string[] = [];
    for (const part of plain(who ?? '').replace(/\([^)]*\)/g, ' ').split(PEOPLE_SPLIT)) {
      const id = part && (b.person(part) ?? peopleNamed(b, part, local).find((x) => x.startsWith('person:')));
      if (id && !owners.includes(id)) owners.push(id);
    }
    for (const o of owners) b.link(o, rec.id, 'owner', 'Theirs to do', 'Owner');
    for (const m of peopleNamed(b, what, local)) if (!owners.includes(m)) b.link(rec.id, m, 'mentions', 'Named in it', 'Names them');
  };
  for (const t of findAllTasks(content, b.ref)) {
    if (PLACEHOLDER.test(plain(t.words))) continue;
    const parts = actionParts(t.words, people, b.ref);
    add(t.line, parts.what, t.done, parts.who, parts.when, t.due, t.text);
  }
  if (isMeeting)
    for (const a of findActions(content, { people })) {
      if (seen.has(a.line)) continue;
      // "Northgate: the quote lapsed" names a place, not who: only someone the vault knows is an owner.
      const k = a.who ? personKey(a.who) : null;
      const first = a.who && !/\s/.test(a.who.trim()) ? people.filter((p) => p.toLowerCase().split(/\s+/)[0] === a.who!.trim().toLowerCase()) : [];
      const known = !!a.who && ((k && b.people.has(k)) || first.length === 1 || /^(me|i)$/i.test(a.who.trim()));
      add(a.line, known ? a.what : a.who ? `${a.who}: ${a.what}` : a.what, false, known ? a.who : undefined, a.whenWords, a.due ?? null);
    }
}

/**
 * What, who and by when in an action's words: Ironleaf's own "what — who · by when", else read plainly ("Sam to send
 * the quote by Friday"). A bold lead is the action's name ("**Send the review.** She asked on 20 Oct…"). A bare name
 * no one knows is a mention, never an owner (5 Nov 2026, u3 moving-in: the one owner confidence) — unless the line is
 * a project step (`deliberate`: the file is managed as a project, so its bare names are its people, made persons in
 * step 9b as before).
 */
export function actionParts(words: string, people: string[] = [], ref: Date = new Date(), deliberate = false): { what: string; who?: string; when?: string } {
  const raw = String(words ?? '').replace(FILED_MARK, '').trim();
  let what = raw;
  let who = '';
  let when = '';
  const dash = /\s+[—–]\s+|\s+--\s+/.exec(raw);
  if (dash) {
    const head = raw.slice(0, dash.index);
    const tail = raw.slice(dash.index + dash[0].length);
    let known = false;
    let onlyLinks = true;
    const knownWho = (bare: string): string | null => {
      const low = bare.toLowerCase();
      const full = people.find((p) => p.toLowerCase() === low);
      if (full) return full;
      const key = personKey(bare);
      if (key) {
        const byKey = people.find((p) => personKey(p) === key);
        if (byKey) return byKey;
      }
      if (!bare.includes(' ')) {
        const firsts = people.filter((p) => p.split(/\s+/)[0]?.toLowerCase() === low);
        if (firsts.length === 1) return firsts[0];
        // A last name alone, when one known person has it and no first name claims it (Nov 2026 audit).
        const lasts = people.filter((p) => {
          const parts = p.split(/\s+/);
          return parts.length > 1 && parts[parts.length - 1]?.toLowerCase() === low;
        });
        if (firsts.length === 0 && lasts.length === 1) return lasts[0];
      }
      return null;
    };
    // A comma before a date word splits too ("Priya Nair, due 2026-11-06"), so a date in an owner line is never a
    // person (p16-owner-tail, 4 Nov 2026); any other comma stays inside the name it joins ("Smith, Jones").
    for (const part of tail.split(/\s+·\s+|\s+[—–]\s+|,\s*(?=(?:by|due|before|on)\s+)/i)) {
      // A link on its own reads as its words (t166, 9 Nov 2026: "— [[Priya Sharma]]" blanked to nothing, so the
      // records left the owner empty and the project page blamed its owner; the meeting reader already reads links
      // this way). Anything else keeps blanking links, exactly as before.
      const linksOnly = !part.replace(LINK_RE, '').trim();
      const bare = plain((linksOnly ? part.replace(LINK_RE, (_m, t: string, a: string) => ` ${(a ?? t).split('/').pop() ?? ''} `) : part.replace(LINK_RE, ' ')).replace(/\([^)]*\)/g, ' ')).replace(/^[,;:\s]+|[,;:\s]+$/g, '');
      if (!bare) continue;
      if (!linksOnly) onlyLinks = false;
      const by = /^(?:by|due|before|on)\s+(.+)$/i.exec(bare);
      if (by && !when) {
        when = by[1];
        known = true;
      } else if (!when && /\d/.test(bare) && isoOfWords(bare, ref)) {
        when = bare;
        known = true;
      } else if (!who) {
        const hit = knownWho(bare);
        if (hit) {
          who = hit;
          known = true;
        } else if (/^unassigned$/i.test(bare)) {
          known = true;
        } else if (/^(me|i|team|the team)$/i.test(bare)) {
          // Explicit self or group attribution, never a stranger's debt.
          who = bare;
          known = true;
        } else if (deliberate && looksLikeNames(bare) && (bare.includes(' ') || /^(tbc|tbd)$/i.test(bare))) {
          // A project step's bare name is its owner (deliberate as before); "tbc" is stripped when added.
          who = bare;
          known = true;
        }
        // Else a bare stranger's name stays in the words (5 Nov 2026, u3 moving-in: the one owner confidence — a
        // mention, never debt). The old fallback blamed whoever a foreign note happened to name ("— Name" in any
        // note became "owes you").
      }
    }
    if (known || onlyLinks) what = head;
  } else {
    // "Sam to send the quote", "Sam: send the quote": only for someone the vault knows.
    const read = readAction(raw, { people, date: ref });
    const k = read?.who ? personKey(read.who) : null;
    if (read?.who && k && people.some((p) => personKey(p) === k)) {
      who = read.who;
      const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const lead = new RegExp(`^\\W*@?(?:${esc(read.who)}|${esc(read.who.split(/\s+/)[0])})\\s*(?::|\\s+(?:to|will|should|must|needs? to|has to|is to))\\s+`, 'i').exec(plain(raw));
      if (lead) what = plain(raw).slice(lead[0].length);
    }
  }
  const bold = /^\s*(?:\*\*|__)(.+?)(?:\*\*|__)/.exec(what);
  if (bold && plain(bold[1]).length >= 8) what = bold[1];
  what = plain(what).replace(/[.;:,]\s*$/, '');
  return { what: what.charAt(0).toUpperCase() + what.slice(1), ...(who ? { who } : {}), ...(when ? { when } : {}) };
}

/** Words that name people: one to four capitalised words each ("Alex Morgan", "Jay / team", "Sam and Mia"). Only for
 *  deliberate lines (a project step's owner); loose lines need someone the vault knows. */
function looksLikeNames(text: string): boolean {
  const parts = text.split(PEOPLE_SPLIT).filter(Boolean);
  if (!parts.length || parts.length > 4) return false;
  return parts.every((p) => /^(me|i|team|the team|tbc|tbd)$/i.test(p) || /^@?[A-Z][\p{L}'’.-]*(?:\s+[A-Z][\p{L}'’.-]*){0,3}$/u.test(p.trim())) && !/\d/.test(text);
}

/** A meeting's decisions: the lines under its Decisions heading. */
function readMeetingDecisions(b: Builder, k: NoteKind, project: string | undefined): void {
  for (const s of sectionsOf(k.note.content)) {
    if (!/^decisions?\b/i.test(s.heading)) continue;
    for (const l of s.lines) {
      const m = /^\s*[-*+]\s+(?:\[[^\]]\]\s+)?(.+)$/.exec(l.text);
      const what = m && plain(m[1]);
      if (!what || what === '-' || what.length < 3) continue;
      const rec = b.add({ id: `decision:${k.note.path}#${slugOf(what)}`, type: 'decision', title: what, path: k.note.path, line: l.line, project, date: b.records.get(k.id)?.date, source: k.id, facts: b.records.get(k.id)?.date ? [{ key: 'date', label: 'Day', value: b.records.get(k.id)!.date! }] : [] });
      b.link(rec.id, k.id, 'source', 'Its meeting', 'Decided in it');
      if (project) b.link(rec.id, `project:${project}`, 'project', 'Its project', 'From a meeting');
    }
  }
}

/** Distinct words of an item that say what it is about: names of places, vendors, numbers (not people, not the project). */
function topicWords(text: string, skip: Set<string>, names?: Set<string>): Set<string> {
  const out = new Set<string>();
  const t = plain(text).replace(/\([^)]*\)/g, (m) => ` ${m.slice(1, -1)} `);
  for (const m of t.matchAll(/(?:^|[\s(/,;:—–])([A-Z][\p{L}]{2,}(?:-[\p{L}]+)*|[A-Z]{2,}[0-9]*|\d{4,})(?=[\s),.;:/—–]|$)/gu)) {
    // A sentence's first word is capitalised for the sentence ("Finalise …"), unless it is a name in capitals ("ANZ").
    if (m.index === 0 && !/^[A-Z0-9]{2,}$/.test(m[1]) && !(names?.has(m[1].toLowerCase()) ?? false)) continue;
    const w = m[1].toLowerCase();
    if (STOP.has(w) || skip.has(w)) continue;
    out.add(w);
  }
  return out;
}

function aboutLinks(b: Builder, items: VaultRecord[], p: Project): void {
  if (items.length < 2) return;
  const skip = new Set<string>([...(p.name.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])]);
  for (const id of b.people.values()) for (const w of (b.records.get(id)?.title ?? '').toLowerCase().split(/\s+/)) skip.add(w);
  // An item's words: its name, and a workstream's next step (each a sentence of its own).
  const textsOf = (r: VaultRecord) => [r.title, r.facts.find((f) => f.key === 'next')?.value ?? ''].filter(Boolean);
  const topics = (r: VaultRecord, names?: Set<string>) => new Set(textsOf(r).flatMap((t) => [...topicWords(t, skip, names)]));
  // Names: the words the project writes capitalised inside a sentence (a first word counts when it is one of them).
  const names = new Set<string>();
  for (const r of items) for (const w of topics(r)) names.add(w);
  const words = new Map(items.map((r) => [r.id, topics(r, names)]));
  const df = new Map<string, number>();
  for (const ws of words.values()) for (const w of ws) df.set(w, (df.get(w) ?? 0) + 1);
  const limit = Math.max(2, Math.ceil(items.length * 0.3));
  const count = new Map<string, number>();
  const pairs: { a: VaultRecord; z: VaultRecord; shared: string[] }[] = [];
  for (let i = 0; i < items.length; i++)
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const z = items[j];
      if (a.type === 'meeting' && z.type === 'meeting') continue;
      const wa = words.get(a.id)!;
      const shared = [...words.get(z.id)!].filter((w) => wa.has(w) && (df.get(w) ?? 0) <= limit);
      if (shared.length) pairs.push({ a, z, shared });
    }
  pairs.sort((x, y) => y.shared.length - x.shared.length);
  const shown = (w: string) => {
    for (const r of items) {
      const m = new RegExp(`\\b(${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})\\b`, 'i').exec(plain(r.title));
      if (m) return m[1];
    }
    return w;
  };
  for (const { a, z, shared } of pairs) {
    if ((count.get(a.id) ?? 0) >= 8 || (count.get(z.id) ?? 0) >= 8) continue;
    count.set(a.id, (count.get(a.id) ?? 0) + 1);
    count.set(z.id, (count.get(z.id) ?? 0) + 1);
    b.link(a.id, z.id, 'about', `Both about ${listWords(shared.map(shown))}`);
  }
}

// ── Asking the model ──────────────────────────────────────────────────────────────────────────────────────────────────

export type GroupKey = 'actions' | 'meetings' | 'people' | 'files' | 'decisions' | 'timeline' | 'projects' | 'notes';
export const GROUP_WORDS: Record<GroupKey, string> = {
  actions: 'Actions',
  meetings: 'Meetings',
  people: 'People',
  files: 'Files',
  decisions: 'Decisions and risks',
  timeline: 'Timeline',
  projects: 'Projects',
  notes: 'Notes',
};
const GROUP_OF: Record<RecordType, GroupKey> = {
  action: 'actions',
  meeting: 'meetings',
  person: 'people',
  org: 'people',
  file: 'files',
  decision: 'decisions',
  risk: 'decisions',
  milestone: 'timeline',
  workstream: 'timeline',
  project: 'projects',
  note: 'notes',
};
export const GROUP_ORDER: GroupKey[] = ['actions', 'meetings', 'people', 'files', 'decisions', 'timeline', 'projects', 'notes'];

export interface ConnectedItem {
  record: VaultRecord;
  kinds: LinkKind[];
  whys: string[];
}
export interface ConnectedGroup {
  key: GroupKey;
  label: string;
  items: ConnectedItem[];
}

/** Whether an action, risk or workstream is still open. */
export const isOpen = (r: VaultRecord) => !r.done && !isFinished(r.status);

function order(a: VaultRecord, z: VaultRecord, today: string): number {
  // Open before done; then by day (overdue and soonest first), then by name.
  const oa = isOpen(a) ? 0 : 1;
  const oz = isOpen(z) ? 0 : 1;
  if (oa !== oz) return oa - oz;
  const da = a.due ?? a.date ?? '';
  const dz = z.due ?? z.date ?? '';
  if (a.type === 'meeting' && z.type === 'meeting') return dz.localeCompare(da);
  if (da && dz) return da.localeCompare(dz);
  if (da || dz) return da ? -1 : 1;
  void today;
  return a.title.localeCompare(z.title);
}

/** Everything connected to a record, each with how. */
export function connectedTo(model: RecordModel, id: string): ConnectedItem[] {
  return (model.adj.get(id) ?? []).map((n) => ({ record: model.records.get(n.id)!, kinds: n.kinds, whys: n.whys })).filter((x) => x.record);
}

/** Plain words that tell tied rows apart: where it was written, which project, who, by when. */
function tieBreakers(model: RecordModel, self: string, r: VaultRecord): string[] {
  const out: string[] = [];
  if (r.source) {
    const s = model.records.get(r.source);
    if (s && s.id !== self) out.push(`from ${s.title}`);
  }
  if (r.project) {
    const p = model.records.get(`project:${r.project}`);
    if (p && p.id !== self) out.push(`in ${p.title}`);
  }
  if (r.owner && plain(r.owner)) out.push(plain(r.owner));
  if (r.due) out.push(`due ${r.due}`);
  else if (r.date) out.push(r.date);
  return out;
}

/** Within one group, rows that would read the same gain plain words until they don't (p17-connected, 4
 *  Nov 2026): two actions say whose ("Action · Sam Okafor"), two tasks say where ("Theirs to do ·
 *  from Walk"). The first difference wins; what stays tied had nothing to say. */
function breakTies(model: RecordModel, self: string, items: ConnectedItem[]): ConnectedItem[] {
  const readings = items.map((x) => x.whys.filter(Boolean).join(' · '));
  const tied = new Map<string, number[]>();
  readings.forEach((w, i) => tied.set(w, [...(tied.get(w) ?? []), i]));
  let out = items.slice();
  for (const idx of tied.values()) {
    if (idx.length < 2) continue;
    const breaks = idx.map((i) => tieBreakers(model, self, out[i].record));
    const depth = Math.max(...breaks.map((b) => b.length));
    for (let d = 0; d < depth; d++) {
      const current = idx.map((i) => out[i].whys.filter(Boolean).join(' · '));
      if (new Set(current).size === current.length) break;
      idx.forEach((i, k) => {
        const v = breaks[k][d];
        if (v && !out[i].whys.includes(v)) out[i] = { ...out[i], whys: [...out[i].whys, v] };
      });
    }
  }
  return out;
}

/** Everything connected to a record, grouped as the peek shows it (actions, meetings, people, files, decisions, timeline…). */
export function groupConnected(model: RecordModel, id: string): ConnectedGroup[] {
  const me = model.records.get(id);
  let items = connectedTo(model, id);
  // One action written twice — a meeting's line and the project step filed from it — shows once: the copy written here
  // (else the project's), saying where the other is.
  const twins = new Map<string, string>();
  for (const it of items)
    if (it.record.type === 'action')
      for (const n of model.adj.get(it.record.id) ?? []) if (n.kinds.includes('source') && n.id.startsWith('action:') && items.some((x) => x.record.id === n.id)) twins.set(it.record.id, n.id);
  const dropped = new Set<string>();
  for (const [a, z] of twins) {
    if (dropped.has(a) || dropped.has(z)) continue;
    const ra = model.records.get(a)!;
    const rz = model.records.get(z)!;
    const keepA = me && (ra.path === me.path || (rz.path !== me.path && ra.path === ra.project));
    const [keep, drop] = keepA ? [a, z] : [z, a];
    dropped.add(drop);
    const other = model.records.get(drop)!;
    const where = other.path === other.project ? (model.records.get(`project:${other.project}`)?.title ?? 'the project') : (model.records.get(other.source ?? '')?.title ?? other.path.split('/').pop()!.replace(/\.md$/i, ''));
    items = items.map((x) => (x.record.id === keep ? { ...x, whys: [...x.whys, `Also in ${where}`] } : x));
  }
  items = items.filter((x) => !dropped.has(x.record.id));
  const groups = new Map<GroupKey, ConnectedItem[]>();
  for (const it of items) {
    const g = GROUP_OF[it.record.type];
    groups.set(g, [...(groups.get(g) ?? []), it]);
  }
  return GROUP_ORDER.filter((k) => groups.get(k)?.length).map((k) => ({ key: k, label: GROUP_WORDS[k], items: breakTies(model, id, groups.get(k)!.sort((a, z) => order(a.record, z.record, model.today))) }));
}

/** A record, found by its id, or by what a screen drew: its type and note, and its words or line. */
export interface RecordRef {
  id?: string;
  type?: RecordType;
  path?: string;
  title?: string;
  line?: number;
  /** A file in a project's folder (with `path` the project's file). */
  folderFile?: string;
  /** A person or organisation by name. */
  name?: string;
}

export function resolveRef(model: RecordModel, ref: RecordRef): VaultRecord | null {
  if (ref.id && model.records.has(ref.id)) return model.records.get(ref.id)!;
  // A stale id (the note was renamed) falls back to its title words, never “nothing called …” (9.2).
  if (ref.id) {
    const tail = ref.id.split(/[:#/]/).pop()!.replace(/\.md$/i, '');
    const hits = scoredRecords(model, tail, undefined, 2);
    if (hits.length && (!hits[1] || hits[0].s > hits[1].s)) return hits[0].r;
  }
  if (ref.name && (!ref.type || ref.type === 'person' || ref.type === 'org')) {
    const key = personKey(ref.name);
    const id = key ? model.people.get(key) : undefined;
    if (id) return model.records.get(id)!;
    const org = model.records.get(`org:${orgSlug(ref.name)}`);
    if (org) return org;
    const first = plain(ref.name).toLowerCase();
    const byFirst = [...model.people.values()].filter((pid, i, all) => all.indexOf(pid) === i).map((pid) => model.records.get(pid)!).filter((r) => r.title.toLowerCase().split(/\s+/)[0] === first);
    if (byFirst.length === 1) return byFirst[0];
    if (!ref.path) return null;
  }
  if (ref.folderFile && ref.path) {
    const r = model.records.get(`file:${ref.path}::${ref.folderFile.replace(/\\/g, '/')}`);
    if (r) return r;
  }
  if (!ref.path) return null;
  const ids = model.byPath.get(ref.path) ?? [];
  const own = ids.map((i) => model.records.get(i)!).filter((r) => !ref.type || r.type === ref.type);
  if (!ref.title && ref.line === undefined) {
    const whole = own.find((r) => r.line === 0 && (r.type === 'project' || r.type === 'meeting' || r.type === 'note' || r.type === 'person' || r.type === 'org')) ?? (ref.type === 'file' ? model.records.get(`file:${ref.path}`) : undefined);
    return whole ?? null;
  }
  if (ref.title) {
    const want = slugOf(ref.title);
    const exact = own.find((r) => slugOf(r.title) === want);
    if (exact) return exact;
    const starts = own.find((r) => slugOf(r.title).startsWith(want.slice(0, 30)) || want.startsWith(slugOf(r.title).slice(0, 30)));
    if (starts) return starts;
  }
  if (ref.line !== undefined) {
    const at = own.find((r) => r.line === ref.line);
    if (at) return at;
  }
  return null;
}

/** Records whose name matches some words, the best first (people by first name, projects by their initials too). */
export function findRecords(model: RecordModel, words: string, types?: RecordType[], limit = 10): VaultRecord[] {
  return scoredRecords(model, words, types, limit).map((x) => x.r);
}

/** findRecords with how well each matched (100 the name exactly). */
export function scoredRecords(model: RecordModel, words: string, types?: RecordType[], limit = 10): { r: VaultRecord; s: number }[] {
  const q = plain(words).toLowerCase().trim();
  if (!q) return [];
  const qs = slugOf(q);
  const qWords = q.split(/\s+/).filter(Boolean);
  const scored: { r: VaultRecord; s: number }[] = [];
  for (const r of model.records.values()) {
    if (types && !types.includes(r.type)) continue;
    const names = [r.title, ...(r.names ?? [])];
    let s = 0;
    for (const n of names) {
      const t = plain(n).toLowerCase();
      const ts = slugOf(t);
      if (ts === qs) s = Math.max(s, 100);
      else if (ts.startsWith(qs)) s = Math.max(s, 70);
      else if (t.split(/\s+/)[0] === q && (r.type === 'person' || r.type === 'org')) s = Math.max(s, 65);
      else if (ts.includes(qs)) s = Math.max(s, 50);
      else if (qWords.length > 1 && qWords.every((w) => t.includes(w))) s = Math.max(s, 40);
      else if (r.type === 'project' && initialsMatch(t, qWords)) s = Math.max(s, 45);
    }
    if (s) scored.push({ r, s: s + (r.type === 'project' ? 5 : r.type === 'person' ? 4 : r.type === 'meeting' ? 3 : 0) });
  }
  return scored.sort((a, z) => z.s - a.s || a.r.title.localeCompare(z.r.title)).slice(0, limit);
}

/** "LF 2027" for "Lantern Festival 2027 Ashgrove Park": each word of the question is a run of initials or a word of it. */
function initialsMatch(title: string, words: string[]): boolean {
  const tw = title.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  let i = 0;
  for (const w of words) {
    if (/^\d+$/.test(w) || w.length > 4 || /[a-z]{4,}/.test(w)) {
      const at = tw.findIndex((t, n) => n >= i && t.toLowerCase() === w);
      if (at < 0) return false;
      i = at + 1;
      continue;
    }
    let ok = true;
    for (const ch of w) {
      while (i < tw.length && tw[i][0]?.toLowerCase() !== ch) {
        if (/^\d/.test(tw[i])) {
          ok = false;
          break;
        }
        i++;
      }
      if (!ok || i >= tw.length) return false;
      i++;
    }
  }
  return true;
}

export interface PersonItems {
  person: VaultRecord;
  /** Open actions they own (waiting on them). */
  theirs: VaultRecord[];
  /** Open actions about them: in their note, naming them, or linking to them. */
  about: VaultRecord[];
  /** Finished promises they owned, and finished ones about them (t12, 8 Nov 2026: the person's Timeline keeps
   *  finished promises; the open ones live only under You owe / Owes you, never twice). */
  doneTheirs: VaultRecord[];
  doneAbout: VaultRecord[];
  workstreams: VaultRecord[];
  risks: VaultRecord[];
  meetings: VaultRecord[];
  projects: VaultRecord[];
}

/**
 * One deed lists once (5 Nov 2026, v8-vault-assistant: a deed held by both a project and a meeting listed twice). A
 * meeting's action filed into a project action listed beside it is left to the project's line, whose `from:` names
 * the meeting — both notes behind the one line. Never hides a line unless a line in the same state carries it
 * (t12, 8 Nov 2026: finished promises collapse against finished carriers, as open ones do against open).
 */
export function collapseFiled(list: VaultRecord[], model: RecordModel, carrier: (r: VaultRecord) => boolean = isOpen): VaultRecord[] {
  const ids = new Set(list.map((r) => r.id));
  return list.filter((r) => {
    // Only a line written in the meeting itself (filing points the project's line at the meeting too, and that one stays).
    if (r.type !== 'action' || r.source !== `meeting:${r.path}`) return true;
    return !(model.adj.get(r.id) ?? []).some((n) => {
      if (!n.kinds.includes('source') || !n.id.startsWith('action:') || !ids.has(n.id)) return false;
      const target = model.records.get(n.id);
      return !!target && target.path !== r.path && carrier(target);
    });
  });
}

/** What's open with a person: theirs to do, and the open things about them; optionally on one project. Finished
 *  promises ride along (doneTheirs, doneAbout) for the Timeline, collapsed like the open ones. */
export function personOpenItems(model: RecordModel, who: string | RecordRef, opts: { project?: string } = {}): PersonItems | null {
  const person = typeof who === 'string' ? (resolveRef(model, { name: who }) ?? findRecords(model, who, ['person', 'org'], 1)[0] ?? null) : resolveRef(model, who);
  if (!person || (person.type !== 'person' && person.type !== 'org')) return null;
  const inProject = (r: VaultRecord) => !opts.project || r.project === opts.project;
  const near = connectedTo(model, person.id);
  const sort = (list: VaultRecord[]) => list.sort((a, z) => order(a, z, model.today));
  const theirs = near.filter((x) => x.record.type === 'action' && x.kinds.includes('owner') && isOpen(x.record) && inProject(x.record)).map((x) => x.record);
  const about = near.filter((x) => x.record.type === 'action' && !x.kinds.includes('owner') && isOpen(x.record) && inProject(x.record)).map((x) => x.record);
  const done = (owned: boolean) => near.filter((x) => x.record.type === 'action' && (x.kinds.includes('owner') === owned) && !isOpen(x.record) && inProject(x.record)).map((x) => x.record);
  const doneState = (r: VaultRecord) => !isOpen(r);
  return {
    person,
    theirs: sort(collapseFiled(theirs, model)),
    about: sort(collapseFiled(about, model)),
    doneTheirs: sort(collapseFiled(done(true), model, doneState)),
    doneAbout: sort(collapseFiled(done(false), model, doneState)),
    workstreams: sort(near.filter((x) => x.record.type === 'workstream' && x.kinds.includes('owner') && isOpen(x.record) && inProject(x.record)).map((x) => x.record)),
    risks: sort(near.filter((x) => x.record.type === 'risk' && isOpen(x.record) && inProject(x.record)).map((x) => x.record)),
    meetings: near.filter((x) => x.record.type === 'meeting' && inProject(x.record)).map((x) => x.record).sort((a, z) => (z.date ?? '').localeCompare(a.date ?? '')),
    projects: near.filter((x) => x.record.type === 'project').map((x) => x.record),
  };
}

export interface MeetingItems {
  meeting: VaultRecord;
  actions: VaultRecord[];
  decisions: VaultRecord[];
  people: VaultRecord[];
  files: VaultRecord[];
  project: VaultRecord | null;
  milestones: VaultRecord[];
}

/** A meeting's items: its actions (and where they were filed), decisions, people, files and project. */
export function meetingItems(model: RecordModel, which: string | RecordRef): MeetingItems | null {
  const meeting = typeof which === 'string' ? (model.records.get(which) ?? findRecords(model, which, ['meeting'], 1)[0] ?? null) : resolveRef(model, which);
  if (!meeting || meeting.type !== 'meeting') return null;
  const near = connectedTo(model, meeting.id);
  const of = (t: RecordType) => near.filter((x) => x.record.type === t).map((x) => x.record);
  return {
    meeting,
    actions: of('action').sort((a, z) => order(a, z, model.today)),
    decisions: of('decision'),
    people: [...of('person'), ...of('org')],
    files: of('file'),
    project: meeting.project ? (model.records.get(`project:${meeting.project}`) ?? null) : null,
    milestones: of('milestone'),
  };
}

export interface ProjectAttention {
  project: VaultRecord;
  me: string | null;
  overdue: VaultRecord[];
  dueSoon: VaultRecord[];
  mine: VaultRecord[];
  waiting: VaultRecord[];
  /** Open actions no one is named for (a meeting's points to raise, say). */
  unassigned: VaultRecord[];
  lateMilestones: VaultRecord[];
  nextMilestones: VaultRecord[];
  workstreamsAtRisk: VaultRecord[];
  openRisks: VaultRecord[];
  decisions: VaultRecord[];
  files: VaultRecord[];
  meetings: VaultRecord[];
  people: VaultRecord[];
  /** The project's actions written outside its file (meetings, its notes), for the project hub (connectedActions). */
  elsewhere: ConnectedAction[];
  /** The filed ones (the same action in its What's next too): a meeting's card reads its own whole (t248). */
  filedElsewhere: ConnectedAction[];
}

/**
 * A project's actions written outside its own file: a meeting's actions, task lines in the project's notes and people's
 * notes. One filed from a meeting into the project (the same action in its What's next) is left to the project's line.
 * The project hub counts these with the project's own (src/shared/project-hub.ts hubModel `connected`), so an action
 * written only in a meeting's notes still shows in Needs attention, My actions and Waiting on others.
 */
export function connectedActions(model: RecordModel, projectPath: string, filedOnly = false): ConnectedAction[] {
  const out: ConnectedAction[] = [];
  for (const r of model.records.values()) {
    if (r.type !== 'action' || r.project !== projectPath || r.path === projectPath) continue;
    const filed = (model.adj.get(r.id) ?? []).some((n) => n.kinds.includes('source') && n.id.startsWith('action:') && model.records.get(n.id)?.path === projectPath);
    if (filed !== filedOnly) continue;
    const from = r.source ? model.records.get(r.source)?.title : model.records.get(model.byPath.get(r.path)?.find((id) => model.records.get(id)?.page) ?? '')?.title;
    out.push({ id: r.id, path: r.path, ...(r.line !== undefined ? { line: r.line } : {}), what: r.title, ...(r.owner ? { who: plain(r.owner) } : {}), ...(r.when ? { when: plain(r.when) } : {}), ...(r.due ? { due: r.due } : {}), done: !isOpen(r), ...(from ? { from } : {}), ...(r.task !== undefined ? { task: r.task } : {}) });
  }
  return out.sort((a, z) => a.path.localeCompare(z.path) || (a.line ?? 0) - (z.line ?? 0));
}

/**
 * What a project needs, by the project hub's own rules (src/shared/project-hub.ts hubModel): Needs attention, my actions,
 * waiting on others, next milestones, with the actions written elsewhere counted in. The one source the hub's screen, the
 * side chat, the former host app and a chat bot all answer "what needs me on X" from.
 */
export function projectNeeds(model: RecordModel, projectPath: string): HubModel | null {
  const p = model.projects.get(projectPath);
  if (!p) return null;
  const today = readTimelineDay(model.today) ?? readTimelineDay(isoDay(new Date()))!;
  return hubModel({ project: p.project, props: p.props, today, ...(model.me ? { me: model.me } : {}), connected: connectedActions(model, projectPath) });
}

const daysBetweenIso = (a: string, b: string) => Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 86400000);

/** What a project's overview needs: what's overdue and due soon, mine and waiting on others, dates, risks, files, people. */
export function projectAttention(model: RecordModel, projectPath: string, soonDays = 7): ProjectAttention | null {
  const project = model.records.get(`project:${projectPath}`);
  if (!project) return null;
  const today = model.today;
  const all = [...model.records.values()].filter((r) => r.project === projectPath && r.id !== project.id);
  const actions = collapseFiled(
    all.filter((r) => r.type === 'action' && isOpen(r)),
    model,
  );
  const me = model.me ?? project.owner ?? null;
  const meKey = me ? personKey(me) : null;
  const isMine = (r: VaultRecord) => {
    if (!r.owner) return r.path === projectPath;
    if (/^(me|i|myself)$/i.test(r.owner.trim())) return true;
    return !!meKey && plain(r.owner).replace(/\([^)]*\)/g, ' ').split(PEOPLE_SPLIT).some((p) => personKey(p) === meKey || (personKey(p) === null && meKey.split(' ')[0] === p.toLowerCase().trim()));
  };
  const sort = (list: VaultRecord[]) => list.sort((a, z) => order(a, z, today));
  const stream = all.filter((r) => r.type === 'workstream' && isOpen(r));
  return {
    project,
    me,
    overdue: sort(actions.filter((r) => r.due && r.due < today)),
    dueSoon: sort(actions.filter((r) => r.due && r.due >= today && daysBetweenIso(today, r.due) <= soonDays)),
    mine: sort(actions.filter(isMine)),
    waiting: sort(actions.filter((r) => !!r.owner && !isMine(r))),
    unassigned: sort(actions.filter((r) => !r.owner && !isMine(r))),
    lateMilestones: sort(all.filter((r) => r.type === 'milestone' && !r.done && r.date && r.date < today && !/\b(passed|done|held|met)\b/i.test(r.status ?? ''))),
    nextMilestones: all.filter((r) => r.type === 'milestone' && r.date && r.date >= today).sort((a, z) => a.date!.localeCompare(z.date!)),
    workstreamsAtRisk: stream.filter((r) => /\b(at risk|late|off track|blocked|behind|overdue)\b/i.test(r.status ?? '')),
    openRisks: all.filter((r) => r.type === 'risk' && isOpen(r)).sort((a, z) => levelRank(z.level) - levelRank(a.level)),
    decisions: all.filter((r) => r.type === 'decision').sort((a, z) => (z.date ?? '').localeCompare(a.date ?? '')),
    files: all.filter((r) => r.type === 'file').sort((a, z) => (z.mtime ?? 0) - (a.mtime ?? 0)),
    meetings: all.filter((r) => r.type === 'meeting').sort((a, z) => (z.date ?? '').localeCompare(a.date ?? '')),
    people: connectedTo(model, project.id)
      .filter((x) => x.record.type === 'person' || x.record.type === 'org')
      .map((x) => x.record)
      // By name, however the vault was walked (t211, 11 Nov 2026: the same vault gave two orders).
      .sort((a, z) => a.title.localeCompare(z.title)),
    elsewhere: connectedActions(model, projectPath),
    filedElsewhere: connectedActions(model, projectPath, true),
  };
}

const levelRank = (l?: string) => (/critical/i.test(l ?? '') ? 4 : /high/i.test(l ?? '') ? 3 : /medium/i.test(l ?? '') ? 2 : /low/i.test(l ?? '') ? 1 : 0);

// ── For screens and the assistant ─────────────────────────────────────────────────────────────────────────────────────

/** A record's peek: the record and everything connected, grouped (plain data, crosses IPC). */
// Which property each of a meeting's or person's facts writes (round 2, 4 Nov 2026): the note's own spelling first,
// else the first name here. A note's own facts write their own key. A business writes its contact facts the same
// way (10 Nov 2026: the Client file edits a business where it stands).
const NOTE_FACT_PROPS: Partial<Record<RecordType, Record<string, string[]>>> = {
  person: { role: ['role', 'title', 'position'], org: ['org', 'organisation', 'organization', 'company'], email: ['email'], phone: ['phone', 'mobile'] },
  org: { email: ['email'], phone: ['phone', 'mobile'] },
  meeting: { date: ['date', 'when', 'day'], time: ['time', 'start'], attendees: ['attendees', 'people', 'who', 'participants', 'with'], project: ['project', 'projects'], where: ['where', 'place', 'location'] },
};

/** Whether a meeting's, person's or note's fact changes in its own note's properties (the peek reads this before
 *  offering a field). Someone only named in a project changes there instead (their role here); a project's own facts
 *  change through its page's edits. */
export function canEditNoteFact(record: Pick<VaultRecord, 'type' | 'page'>, fact: string): boolean {
  if (!record.page) return false;
  const known = NOTE_FACT_PROPS[record.type]?.[fact];
  if (known) return true;
  if (record.type !== 'note') return false;
  if (fact.includes('.')) return false;
  return !NOT_FACTS.test(fact) || /^(tags?)$/i.test(fact);
}

/** The one property write for a meeting's, person's or note's fact (`typed` as the person typed it, '' clearing),
 *  or null when it has nowhere to write. Lists stay lists, a yes/no stays a yes/no, a number stays a number, a link
 *  stays a link: only the value moves. Nothing here touches the disk. */
export function noteFactWrite(record: Pick<VaultRecord, 'type' | 'page'>, fact: string, props: Record<string, unknown>, typed: string): { key: string; value: string | string[] | boolean | number | null } | null {
  if (!canEditNoteFact(record, fact)) return null;
  const words = String(typed ?? '').replace(/\s+/g, ' ').trim();
  const names = NOTE_FACT_PROPS[record.type]?.[fact] ?? [fact];
  const keys = Object.keys(props ?? {});
  const key = names.map((n) => keys.find((k) => k.toLowerCase() === n.toLowerCase()) ?? n).find((n) => keys.some((k) => k.toLowerCase() === n.toLowerCase())) ?? names[0];
  if (!words) return { key, value: null };
  const raw = props?.[keys.find((k) => k.toLowerCase() === key.toLowerCase()) ?? key];
  if (Array.isArray(raw)) {
    const list = words.split(/\s*[,;]\s*/).map((s) => s.trim()).filter(Boolean);
    return list.length ? { key, value: list } : { key, value: null };
  }
  if (typeof raw === 'boolean') {
    if (/^(yes|true|1)$/i.test(words)) return { key, value: true };
    if (/^(no|false|0)$/i.test(words)) return { key, value: false };
    return null;
  }
  if (typeof raw === 'number') {
    const n = Number(words.replace(/^\$|AUD|USD|EUR|GBP|NZD|CAD|[€£¥₹,]/gi, '').trim());
    return Number.isFinite(n) ? { key, value: n } : null;
  }
  if (typeof raw === 'string' && /^\[\[.*\]\]$/.test(raw.trim()) && !/^\[\[.*\]\]$/.test(words)) return { key, value: `[[${words.slice(0, 300)}]]` };
  return { key, value: words.slice(0, 400) };
}

// Properties every note may carry that are not the note's own facts.
const NOT_FACTS = /^(type|tags|aliases|created|updated|modified|cssclasses|id|level|project|projects|layout|blocks|fields|icon|color|cover|banner|template|neuralvault.*|neuralspark.*)$/i;
/** A typed note's properties as its facts, in the order written ("amount: 65", "autopay: true" → Amount 65, Autopay Yes). */
export function propFacts(props: Record<string, unknown>): RecordFact[] {
  const out: RecordFact[] = [];
  for (const [key, raw] of Object.entries(props)) {
    if (raw === null || raw === undefined) continue;
    // The app's own keeping is never a fact (frontmatter.ts's one list, 6 Nov 2026, o3-meeting-page item 1).
    if (isMachineProp(key)) continue;
    // Tags are facts too; one level of a nested map flattens (“autopay: {day: 8}”) (9.2).
    if (key.toLowerCase() === 'tags' || key.toLowerCase() === 'tag') {
      const v = (Array.isArray(raw) ? raw : [raw]).map(String).filter(Boolean).join(', ');
      if (v) out.push({ key, label: 'Tags', value: v });
      continue;
    }
    if (NOT_FACTS.test(key)) continue;
    if (raw && typeof raw === 'object' && !Array.isArray(raw) && !(raw instanceof Date)) {
      for (const [k2, v2] of Object.entries(raw as Record<string, unknown>)) if (v2 !== null && v2 !== undefined && typeof v2 !== 'object') out.push({ key: `${key}.${k2}`, label: fieldLabel(k2), value: String(v2) });
      continue;
    }
    const value = Array.isArray(raw) ? raw.map((x) => String(x)).filter(Boolean).join(', ') : typeof raw === 'boolean' ? (raw ? 'Yes' : 'No') : raw instanceof Date ? (calendarDayOf(raw) ?? '') : String(raw).trim();
    if (!value) continue;
    // The same words as the module's own table ("cycle" → How often); an amount as money, however written.
    const bare = value.replace(/^\$|AUD|USD|EUR|GBP|NZD|CAD|[€£¥₹,]/gi, '').trim();
    const money = /(amount|balance|budget|spent|price|cost|value|minimum|limit|rate|fee|total)/i.test(key) && /^-?\d+(\.\d+)?$/.test(bare);
    out.push({ key, label: fieldLabel(key), value: money ? `$${Number(bare).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : value.replace(/^\[\[(.*)\]\]$/, '$1') });
  }
  return out.slice(0, 24);
}

export interface RecordPeek {
  record: VaultRecord;
  groups: ConnectedGroup[];
  /** The project's name, when it belongs to one. */
  projectTitle?: string;
}

export function peekOf(model: RecordModel, ref: RecordRef): RecordPeek | null {
  const record = resolveRef(model, ref);
  if (!record) return null;
  return { record, groups: groupConnected(model, record.id), ...(record.project ? { projectTitle: model.records.get(`project:${record.project}`)?.title } : {}) };
}

/** One line about a record for the assistant: "Action · Send the review — Alex Morgan · due 2026-10-26 (open) [id]". */
export function recordLine(r: VaultRecord, model?: RecordModel): string {
  const bits = [`${TYPE_WORDS[r.type]}: ${r.title}`];
  if (r.owner) bits.push(`who: ${plain(r.owner)}`);
  if (r.due) bits.push(`due ${r.due}${model && isOpen(r) && r.due < model.today ? ' (overdue)' : ''}`);
  else if (r.when) bits.push(`by ${r.when}`);
  if (r.date && r.type !== 'action') bits.push(r.date);
  if (r.status && r.type !== 'action') bits.push(`status: ${r.status}`);
  if (r.type === 'action') bits.push(r.done ? 'done' : 'open');
  if (r.level) bits.push(`impact: ${r.level}`);
  if (r.project && model) bits.push(`project: ${model.records.get(`project:${r.project}`)?.title ?? r.project}`);
  if (r.source && model) bits.push(`from: ${model.records.get(r.source)?.title ?? r.source}`);
  bits.push(`note: ${r.path}${r.line ? ` line ${r.line + 1}` : ''}`);
  return bits.join(' · ');
}

// ── The assistant's questions (the side chat, outside agents, the former host app and a chat bot ask with the same
// words) ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const RECORD_TOOLS = [
  {
    name: 'connected_to',
    description:
      'Everything connected to one thing in the vault: a person, project, meeting, action, file, decision, risk, milestone, workstream or note (by its name, its note\'s path, or a record id from an earlier answer). Answers with the thing\'s fields and what joins it, grouped (actions, meetings, people, files, decisions and risks, timeline, projects, notes), each with why it is joined. Use it for "everything about Darcy", "what\'s linked to the Tessaly quote".',
    parameters: { type: 'object', properties: { what: { type: 'string', description: 'A name, a note path or a record id.' }, type: { type: 'string', enum: RECORD_TYPES, description: 'What kind of thing, when the name could be several.' } }, required: ['what'], additionalProperties: false },
  },
  {
    name: 'person_open_items',
    description:
      'What is open with a person: the actions that are theirs to do (waiting on them), open actions about them (in their note, naming them), workstreams they lead, risks they own and their meetings; optionally on one project. Leave person out for the person themselves ("what needs me on LF 2027?"): then the project\'s overdue items, late dates, workstreams at risk and high risks come too. Use it for "what\'s open with Bettina", "chase Bettina", "what needs me today".',
    parameters: { type: 'object', properties: { person: { type: 'string', description: 'Their name (a first name is enough when only one person has it). Leave out for the person themselves.' }, project: { type: 'string', description: 'Keep to one project (its name, or initials such as "LF 2027").' } }, additionalProperties: false },
  },
  {
    name: 'meeting_items',
    description: 'One meeting\'s items: its actions (who, by when, open or done, and the project step each was filed as), decisions, attendees, files, its project and the key date on its day. Use it for "every open item from the Tessaly meeting".',
    parameters: { type: 'object', properties: { meeting: { type: 'string', description: 'The meeting note\'s name or path (part of the name is enough).' } }, required: ['meeting'], additionalProperties: false },
  },
] as const;

const MAX_GROUP = 12;
const lines = (list: VaultRecord[], model: RecordModel, max = MAX_GROUP) => [...list.slice(0, max).map((r) => `- ${recordLine(r, model)} [${r.id}]`), ...(list.length > max ? [`- … and ${list.length - max} more`] : [])];

/** The projects some words name: the one best match, or every project that matches as well ("LF 2027": both). */
function projectsNamed(model: RecordModel, words: string): VaultRecord[] {
  const byPath = model.records.get(`project:${words}`);
  if (byPath) return [byPath];
  const hits = scoredRecords(model, words, ['project'], 8);
  if (!hits.length) return [];
  return hits.filter((h) => h.s === hits[0].s).map((h) => h.r);
}

/** One record for the assistant: by id, by note path, else the best match for the name. */
function oneRecord(model: RecordModel, what: string, type?: RecordType): { record: VaultRecord | null; others: VaultRecord[] } {
  const w = String(what ?? '').trim();
  if (!w) return { record: null, others: [] };
  if (model.records.has(w)) return { record: model.records.get(w)!, others: [] };
  const byPath = resolveRef(model, { path: w.replace(/\\/g, '/'), ...(type ? { type } : {}) }) ?? resolveRef(model, { path: `${w.replace(/\\/g, '/')}.md` });
  if (byPath) return { record: byPath, others: [] };
  if (!type || type === 'person' || type === 'org') {
    const person = resolveRef(model, { name: w });
    if (person) return { record: person, others: [] };
  }
  const hits = scoredRecords(model, w, type ? [type] : undefined, 6);
  return { record: hits[0]?.r ?? null, others: hits.slice(1).filter((h) => h.s >= hits[0].s - 5).map((h) => h.r) };
}

/** Closest names for a miss, in plain words; never an internal tool name (9.2). */
function didYouMean(model: RecordModel, words: string, types?: RecordType[]): string {
  const hits = scoredRecords(model, words, types, 3);
  return hits.length ? ` Did you mean ${hits.map((h) => `“${h.r.title}”`).join(', ')}?` : '';
}

export function answerConnected(model: RecordModel, args: { what?: unknown; type?: unknown }): string {
  const type = RECORD_TYPES.includes(args.type as RecordType) ? (args.type as RecordType) : undefined;
  const { record, others } = oneRecord(model, String(args.what ?? ''), type);
  if (!record) return `Nothing in the vault is called “${String(args.what ?? '')}”.${didYouMean(model, String(args.what ?? ''), type ? [type] : undefined)}`;
  const out = [`${recordLine(record, model)} [${record.id}]`];
  for (const f of record.facts) if (!['owner', 'project', 'source'].includes(f.key)) out.push(`  ${f.label}: ${f.value}`);
  if (others.length) out.push(`(Also matching: ${others.map((r) => `${TYPE_WORDS[r.type]} “${r.title}” [${r.id}]`).join('; ')})`);
  const groups = groupConnected(model, record.id);
  if (!groups.length) out.push('Nothing is connected to it yet.');
  for (const g of groups) {
    out.push('', `${g.label} (${g.items.length}):`);
    for (const it of g.items.slice(0, MAX_GROUP)) out.push(`- ${recordLine(it.record, model)}${it.whys.filter(Boolean).length ? ` — ${it.whys.filter(Boolean).join('; ')}` : ''} [${it.record.id}]`);
    if (g.items.length > MAX_GROUP) out.push(`- … and ${g.items.length - MAX_GROUP} more`);
  }
  return out.join('\n');
}

export function answerPerson(model: RecordModel, args: { person?: unknown; project?: unknown }): string {
  const projects = typeof args.project === 'string' && args.project.trim() ? projectsNamed(model, args.project.trim()) : [];
  if (typeof args.project === 'string' && args.project.trim() && !projects.length) return `No project is called “${args.project}”.${didYouMean(model, String(args.project), ['project'])}`;
  // No one named and no one known as "me": the named project's owner, as the project's Overview takes it.
  const who = String(args.person ?? '').trim() || model.me || (projects.length === 1 ? (projects[0].owner ?? '') : '');
  if (!who) return 'Say whose items to look at: no one is named, and no project owner is known here.';
  const scopes = projects.length ? projects.map((p) => p.path) : [undefined];
  const out: string[] = [];
  let person: VaultRecord | null = null;
  for (const project of scopes) {
    const items = personOpenItems(model, who, project ? { project } : {});
    if (!items) return `No one called “${who}” is in the vault (People notes, a project's People, owners, attendees).`;
    person = items.person;
    if (project) out.push('', `On ${model.records.get(`project:${project}`)!.title}:`);
    // The person themselves on a project: what needs them there, by the project hub's own rules (the same Needs
    // attention, My actions and Waiting on others the project's Overview shows).
    const self = !String(args.person ?? '').trim() || (!!model.me && personKey(model.me) === personKey(items.person.title));
    const hub = project && self ? projectNeeds(model, project) : null;
    if (project && hub) {
      out.push(...needsLines(model, project, hub, items));
      continue;
    }
    out.push(`Theirs to do, open (${items.theirs.length}):`, ...lines(items.theirs, model));
    out.push(`Open and about them (${items.about.length}):`, ...lines(items.about, model));
    if (items.workstreams.length) out.push(`Workstreams they lead (${items.workstreams.length}):`, ...lines(items.workstreams, model));
    if (items.risks.length) out.push(`Open risks they own or are named in (${items.risks.length}):`, ...lines(items.risks, model));
    if (items.meetings.length) out.push(`Their meetings (${items.meetings.length}):`, ...lines(items.meetings, model, 6));
  }
  return [`${recordLine(person!, model)} [${person!.id}]`, ...out].join('\n');
}

/** A project's needs for the assistant, as its Overview shows them. */
function needsLines(model: RecordModel, project: string, hub: HubModel, items: PersonItems): string[] {
  const out: string[] = [];
  const iso = (day: number | undefined) => (day === undefined ? '' : isoOfDay(day));
  const TYPE_OF: Partial<Record<string, RecordType>> = { next: 'action', run: 'action', date: 'milestone', risk: 'risk', decision: 'decision' };
  const refOf = (ref: HubModel['attention'][number]['ref'], title: string): VaultRecord | null => {
    if (ref.kind === 'record') return model.records.get(ref.id) ?? null;
    const type = TYPE_OF[ref.kind];
    return type ? resolveRef(model, { type, path: project, title: title.replace(/…$/, '') }) : null;
  };
  const actionLine = (a: HubModel['actions'][number]) => {
    const rec = a.ref.kind === 'record' ? model.records.get(a.ref.id) : resolveRef(model, { type: 'action', path: project, title: a.what });
    const bits = [`Action: ${plain(a.what)}`];
    if (a.who) bits.push(`who: ${plain(a.who)}`);
    if (a.due !== undefined) bits.push(`due ${iso(a.due)}${a.overdue ? ' (overdue)' : ''}`);
    else if (a.when) bits.push(`by ${plain(a.when)}`);
    if (a.since !== undefined) bits.push(`asked ${iso(a.since)}`);
    if (a.from) bits.push(`from: ${a.from}`);
    if (rec) bits.push(`note: ${rec.path}${rec.line ? ` line ${rec.line + 1}` : ''}`);
    return `- ${bits.join(' · ')}${rec ? ` [${rec.id}]` : ''}`;
  };
  const capped = <T,>(list: T[], max: number, line: (x: T) => string) => [...list.slice(0, max).map(line), ...(list.length > max ? [`- … and ${list.length - max} more`] : [])];
  out.push(`Needs attention (${hub.attention.length}):`);
  out.push(
    ...capped(hub.attention, MAX_GROUP, (a) => {
      const rec = refOf(a.ref, a.title);
      return `- ${a.title} — ${a.detail}${a.day !== undefined ? ` (${iso(a.day)})` : ''}${rec ? ` [${rec.id}]` : ''}`;
    }),
  );
  if (!hub.attention.length) out.push('- Nothing overdue, late or waiting too long.');
  out.push(`Yours to do, open (${hub.mine.length}):`, ...capped(hub.mine, MAX_GROUP, actionLine));
  if (hub.unowned.length) out.push(`No owner yet (${hub.unowned.length}):`, ...capped(hub.unowned, 8, actionLine));
  if (hub.waiting.length) {
    out.push(`Waiting on others (${hub.counts.waiting}):`);
    for (const g of hub.waiting.slice(0, 8)) {
      out.push(`${g.person}${g.overdue ? ` (${g.overdue} overdue)` : g.waitingDays ? ` (waiting ${g.waitingDays} days)` : ''}:`);
      out.push(...capped(g.items, 6, actionLine));
    }
  }
  if (hub.upcoming.length) out.push('Next key dates:', ...hub.upcoming.slice(0, 4).map((m) => `- Milestone: ${plain(m.what)} · ${iso(m.day)}${m.status ? ` · status: ${m.status}` : ''}`));
  const atRisk = hub.workstreams.filter((w) => !w.done && /\b(at risk|late|off track|blocked|behind|overdue)\b/i.test(w.status));
  if (atRisk.length) out.push(`Workstreams at risk or late (${atRisk.length}):`, ...atRisk.map((w) => `- Workstream: ${plain(w.name)}${w.owner ? ` · who: ${plain(w.owner)}` : ''} · status: ${w.status}`));
  const high = hub.openRisks.filter((r) => r.high);
  if (high.length) out.push(`Open high risks (${high.length}):`, ...high.slice(0, 8).map((r) => `- Risk: ${plain(r.what)}${r.owner ? ` · who: ${plain(r.owner)}` : ''}${r.impact ? ` · impact: ${r.impact}` : ''}`));
  if (items.meetings.length) out.push(`Your meetings on it (${items.meetings.length}):`, ...lines(items.meetings, model, 6));
  return out;
}

export function answerMeeting(model: RecordModel, args: { meeting?: unknown }): string {
  const w = String(args.meeting ?? '').trim();
  const { record, others } = oneRecord(model, w, 'meeting');
  const items = record ? meetingItems(model, record.id) : null;
  if (!items) return `No meeting note is called “${w}”.${didYouMean(model, w, ['meeting'])}`;
  const out = [`${recordLine(items.meeting, model)} [${items.meeting.id}]`];
  if (others.length) out.push(`(Also matching: ${others.map((r) => `“${r.title}” [${r.id}]`).join('; ')})`);
  if (items.project) out.push(`Project: ${items.project.title}`);
  if (items.people.length) out.push(`Attendees and people: ${items.people.map((p) => p.title).join(', ')}`);
  const open = items.actions.filter(isOpen);
  out.push(`Actions (${open.length} open of ${items.actions.length}):`, ...lines(items.actions, model, 30));
  if (items.decisions.length) out.push(`Decisions (${items.decisions.length}):`, ...lines(items.decisions, model));
  if (items.milestones.length) out.push(`Key dates on its day:`, ...lines(items.milestones, model));
  if (items.files.length) out.push(`Files (${items.files.length}):`, ...lines(items.files, model));
  return out.join('\n');
}

/** The answer to one of RECORD_TOOLS, by its name. */
export function answerRecordTool(model: RecordModel, name: string, args: Record<string, unknown>): string | null {
  if (name === 'connected_to') return answerConnected(model, args);
  if (name === 'person_open_items') return answerPerson(model, args);
  if (name === 'meeting_items') return answerMeeting(model, args);
  return null;
}
