// A project's records for its workspace (24 Oct 2026, Workstream 1 part D: the notebook becomes the project workspace).
// Everything a project holds, read as small structured records the workspace's views can lay out, group, filter, chart
// and move between sections: actions and follow-ups, milestones, workstreams (or a run sheet's phases), meetings, files,
// people, risks, decisions, updates, notes, the rows of the person's own tables (a register, a pipeline), and log
// entries. Each record says where it came from in the person's Markdown (`ref`), so a change made in a view is one edit
// of that line, cell or property, and every other character stays as written.
//
// The project's own records are read here from the project file (src/shared/project-file.ts, src/shared/layouts.ts) and
// the notes' properties; its actions written elsewhere (a meeting's actions, task lines in its notes) come from the
// connected vault (src/shared/records.ts connectedActions, given as `connected`), the same list the project hub counts, so
// the workspace's Actions and the Overview agree (WS1 integration, 24 Oct 2026). `projectRecords` and `vaultRecords`
// are the only ways in.
//
// Pure: no files, no window. The tests run it directly (tests/workspace-records.test.mjs).

import { daysBetween, isoDay, readDay, startOfDay } from './days';
import { column, itemParts, milestones, readTable, runSheet, sectionText, type LogNote } from './layouts';
import { isMeetingNote } from './meetings';
import type { Project, ProjectList } from './project-file';
import { alike, DONE_WORDS, mainPerson, matchWorkstream, sameFile, type ConnectedAction } from './project-hub';
import { isPersonNote } from './tasks';
import { filePurpose, fileVersion } from './file-records';

// bill, account, budget, spend and document are the Finance and Documents and ID modules' records (Wave 5,
// src/shared/record-modules.ts), laid out by the same views; series to contract are the work modules' (Wave 6 part b,
// src/shared/work-modules.ts).
// album to listitem are the Wave 7 part b modules' records (src/shared/life-records.ts: Memories and Media, Business,
// Systems and Home Lab, Goals and Habits, Reading, Watching and Lists); a goal's milestones are milestones.
const LIFE_RECORD_KINDS = ['album', 'photo', 'creative', 'release', 'customer', 'campaign', 'post', 'ticket', 'website', 'check', 'machine', 'service', 'runbook', 'run', 'healthnote', 'goal', 'habit', 'greview', 'list', 'listitem'] as const;
// application to due-date are the Wave 7 part a modules' records (Home, Vehicles, Career, Travel: src/shared/house.ts,
// vehicles.ts, career.ts, travel.ts); a home's rooms are rooms.
const PERSONAL_RECORD_KINDS = ['application', 'interview', 'letter', 'cv', 'trip', 'booking', 'expense', 'appliance', 'upkeep', 'utility', 'vehicle', 'fuel', 'servicing', 'due-date'] as const;
export const RECORD_KINDS = ['action', 'milestone', 'workstream', 'meeting', 'file', 'person', 'risk', 'decision', 'question', 'update', 'note', 'item', 'entry', 'bill', 'account', 'budget', 'spend', 'document', 'series', 'weekly', 'wsweek', 'metric', 'site', 'room', 'device', 'patch', 'vendor', 'quote', 'order', 'contract', ...LIFE_RECORD_KINDS, ...PERSONAL_RECORD_KINDS] as const;
export type RecordKind = (typeof RECORD_KINDS)[number];

export const KIND_WORDS: Record<RecordKind, { one: string; many: string }> = {
  action: { one: 'Action', many: 'Actions' },
  milestone: { one: 'Milestone', many: 'Milestones' },
  workstream: { one: 'Workstream', many: 'Workstreams' },
  meeting: { one: 'Meeting', many: 'Meetings' },
  file: { one: 'File', many: 'Files' },
  person: { one: 'Person', many: 'People' },
  risk: { one: 'Risk', many: 'Risks' },
  decision: { one: 'Decision', many: 'Decisions' },
  question: { one: 'Question', many: 'Questions' },
  update: { one: 'Update', many: 'Updates' },
  note: { one: 'Note', many: 'Notes' },
  item: { one: 'Row', many: 'Rows' },
  entry: { one: 'Entry', many: 'Entries' },
  bill: { one: 'Bill', many: 'Bills' },
  account: { one: 'Account', many: 'Accounts' },
  budget: { one: 'Budget', many: 'Budgets' },
  spend: { one: 'Payment', many: 'Payments' },
  document: { one: 'Document', many: 'Documents' },
  series: { one: 'Meeting series', many: 'Meeting series' },
  weekly: { one: 'Weekly update', many: 'Weekly updates' },
  wsweek: { one: 'Workstream week', many: 'Workstream weeks' },
  metric: { one: 'Metric', many: 'Metrics' },
  site: { one: 'Site', many: 'Sites' },
  room: { one: 'Room', many: 'Rooms' },
  device: { one: 'Device', many: 'Devices' },
  patch: { one: 'Patch point', many: 'Patch points' },
  vendor: { one: 'Vendor', many: 'Vendors' },
  quote: { one: 'Quote', many: 'Quotes' },
  order: { one: 'Purchase order', many: 'Purchase orders' },
  contract: { one: 'Contract', many: 'Contracts' },
  album: { one: 'Album', many: 'Albums' },
  photo: { one: 'Photo', many: 'Photos' },
  creative: { one: 'Creative project', many: 'Creative projects' },
  release: { one: 'Release', many: 'Releases' },
  customer: { one: 'Customer', many: 'Customers' },
  campaign: { one: 'Campaign', many: 'Campaigns' },
  post: { one: 'Post', many: 'Posts' },
  ticket: { one: 'Support item', many: 'Support items' },
  website: { one: 'Website', many: 'Websites' },
  check: { one: 'Check', many: 'Checks' },
  machine: { one: 'Machine', many: 'Machines' },
  service: { one: 'Service', many: 'Services' },
  runbook: { one: 'Runbook', many: 'Runbooks' },
  run: { one: 'Run', many: 'Runs' },
  healthnote: { one: 'Health note', many: 'Health notes' },
  goal: { one: 'Goal', many: 'Goals' },
  habit: { one: 'Habit', many: 'Habits' },
  greview: { one: 'Goals review', many: 'Goals reviews' },
  list: { one: 'List', many: 'Lists' },
  listitem: { one: 'Item', many: 'Items' },
  application: { one: 'Application', many: 'Applications' },
  interview: { one: 'Interview', many: 'Interviews' },
  letter: { one: 'Cover letter', many: 'Cover letters' },
  cv: { one: 'CV version', many: 'CV versions' },
  trip: { one: 'Trip', many: 'Trips' },
  booking: { one: 'Booking', many: 'Bookings' },
  expense: { one: 'Expense', many: 'Expenses' },
  appliance: { one: 'Appliance', many: 'Appliances' },
  upkeep: { one: 'Maintenance job', many: 'Maintenance' },
  utility: { one: 'Utility', many: 'Utilities' },
  vehicle: { one: 'Vehicle', many: 'Vehicles' },
  fuel: { one: 'Fill-up', many: 'Fill-ups' },
  servicing: { one: 'Service', many: 'Service history' },
  'due-date': { one: 'Due date', many: 'Due dates' },
};

export type FieldValue = string | number | boolean | null;

/** Where a record lives in the person's Markdown, so a change is one edit there. */
export type RecordRef =
  | { at: 'list'; list: ProjectList; index: number }
  /** A tick box in a section of phases (a run sheet): its line in the section's words. */
  | { at: 'runsheet'; heading: string; line: number }
  /** A phase of a run sheet (### heading): its place among the phases. */
  | { at: 'phase'; heading: string; phase: number }
  /** A row of a table in a section of the person's own: its place among the rows, and the column each field is in. */
  | { at: 'table'; heading: string; row: number; cols: Record<string, number> }
  | { at: 'note'; path: string }
  | { at: 'file'; rel: string }
  | { at: 'log'; path: string; date: string }
  /** An action written outside the project's file (a meeting's, a note's): its record in the connected vault, its note
   *  and line, and a tick box's words (only its tick is changed from here: the rest is the meeting's own words). */
  | { at: 'elsewhere'; id: string; path: string; line?: number; task?: string };

export interface WsRecord {
  /** Stable while the project's lines stay where they are: "<project path>::<kind>:<where>". */
  id: string;
  kind: RecordKind;
  title: string;
  /** The project file it belongs to (none for a vault record outside every project). */
  project?: string;
  projectName?: string;
  /** A note or file the record IS (a meeting note, a person's note, a file): opened by it. */
  path?: string;
  /** A line in that note (a meeting's task, decision or question): opened at it. */
  line?: number;
  fields: Record<string, FieldValue>;
  /** Other records it is joined to, by id (an action's workstream, a meeting's people…). */
  links: string[];
  ref?: RecordRef;
}

/** A note as the window's index has it (the parts records need). */
export interface RecordNote {
  path: string;
  title: string;
  mtime: number;
  props: Record<string, unknown>;
  /** The note's links, as written ("[[Name]]" targets). */
  links?: string[];
  tags?: string[];
}

export interface ProjectRecordsInput {
  path: string;
  project: Project;
  props?: Record<string, unknown>;
  /** Notes in the project's folder, and notes elsewhere naming it (a `project:` property or a link). */
  notes?: RecordNote[];
  /** The project folder's files, when they can be read on this PC (rel paths inside the folder). */
  files?: { rel: string; name: string; ext: string; modified: number; size?: number }[];
  logs?: LogNote[];
  /** The project's actions written elsewhere, from the connected vault (records.ts connectedActions). */
  connected?: ConnectedAction[];
  today?: Date;
}

const clean = (s: unknown) =>
  String(s ?? '')
    .replace(/\*\*|__/g, '')
    .replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?\]\]/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
const norm = (s: string) => s.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const folderOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
const baseName = (path: string) => (path.split('/').pop() ?? path).replace(/\.md$/i, '');
const isoOf = (text: string | undefined, today: Date): string | null => {
  const t = clean(text);
  if (!t || !/\d|today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|week|month/i.test(t)) return null;
  // Words before the day ("Requested 13 Oct", "Before 2026-12-20") are read from the first figure on.
  const bare = t.replace(/^[^\d]*?(?=\d)/, '');
  const tries = [t, bare, t.replace(/\s*\(.*$/, ''), bare.replace(/\s*\(.*$/, ''), t.replace(/\s*[,(].*$/, ''), bare.replace(/\s*[,(].*$/, '')];
  for (const x of tries) {
    const d = readDay(x, today);
    if (d) return isoDay(d);
  }
  return null;
};
/** A link's target as written ("[[Name|shown]]" → "Name"), or the words. */
const linkTarget = (v: unknown) => {
  const m = /\[\[([^\]|#]+)/.exec(String(v ?? ''));
  return (m ? m[1] : String(v ?? '')).trim();
};

// What a file is for and the version in its name: one set of rules with the files' own (src/shared/file-records.ts).
export { PURPOSES, filePurpose, fileVersion } from './file-records';

/** How an action stands on a day: done, overdue, due today, or open. */
export function actionStatus(done: boolean, due: string | null, today: Date): string {
  if (done) return 'Done';
  if (due) {
    const n = daysBetween(startOfDay(today), new Date(`${due}T00:00:00`));
    if (n < 0) return 'Overdue';
    if (n === 0) return 'Due today';
  }
  return 'Open';
}

/** A milestone's status in a word: as written when it says something, else worked out from its day. */
function milestoneStatus(written: string, iso: string | undefined, today: Date): string {
  const s = written.trim();
  if (s) return s.charAt(0).toUpperCase() + s.slice(1);
  if (!iso) return 'Planned';
  return iso < isoDay(today) ? 'Passed' : 'Planned';
}

/** Who and when from an action's tail when the day was written among the names ("Jesse · Fri 23 Oct, 11:00 AM"). */
function whoAndWhen(who: string | undefined, when: string | undefined, today: Date): { who: string; when: string } {
  if (when || !who || !/\s·\s/.test(who)) return { who: who ?? '', when: when ?? '' };
  const parts = who.split(/\s+·\s+/);
  const day = parts.findIndex((x) => /\d/.test(x) && !!isoOf(x, today));
  if (day < 0) return { who, when: '' };
  return { who: parts.filter((_, i) => i !== day).join(' · '), when: parts[day] };
}

/** Owner words from an action's tail: "Alex Morgan with Jay Lu (Garden club)" → "Alex Morgan". */
function ownerOf(who: string): string {
  const w = clean(who).replace(/\s*\(.*$/, '');
  if (!w || /^unassigned\b/i.test(w)) return '';
  return mainPerson(w);
}

/**
 * Every record of one project. Ids start with the project's path, so records from several projects never clash.
 */
export function projectRecords(input: ProjectRecordsInput): WsRecord[] {
  const { path, project: p } = input;
  const today = input.today ?? new Date();
  const name = p.name;
  const out: WsRecord[] = [];
  const id = (kind: RecordKind, where: string | number) => `${path}::${kind}:${where}`;
  const base = { project: path, projectName: name };

  // Workstreams: a Workstreams table, else the phases of a run sheet.
  const wsBody = sectionText(p, 'Workstreams');
  const wsTable = readTable(wsBody);
  const workstreams: WsRecord[] = [];
  if (wsTable && wsTable.rows.length) {
    const cols = {
      title: Math.max(0, column(wsTable, /workstream|stream|area|name|what/i)),
      owner: column(wsTable, /owner|who|lead/i),
      status: column(wsTable, /status|state|rag/i),
      progress: column(wsTable, /progress|%|complete/i),
      next: column(wsTable, /next/i),
    };
    const own: Record<string, number> = {};
    for (const [k, v] of Object.entries(cols)) if (v >= 0) own[k] = v;
    wsTable.rows.forEach((row, i) => {
      const cell = (c: number) => (c >= 0 ? clean(row[c] ?? '') : '');
      const prog = Number(String(cell(cols.progress)).replace(/%$/, ''));
      const title = cell(cols.title);
      if (!title) return;
      workstreams.push({
        ...base,
        id: id('workstream', i),
        kind: 'workstream',
        title,
        fields: { owner: cell(cols.owner) || null, status: cell(cols.status) ? cap(cell(cols.status)) : null, progress: cell(cols.progress) && Number.isFinite(prog) ? prog : null, next: cell(cols.next) || null, source: 'Workstreams' },
        links: [],
        ref: { at: 'table', heading: 'Workstreams', row: i, cols: own },
      });
    });
  }
  const runHeading = sectionText(p, 'Run sheet') ? 'Run sheet' : '';
  const phases = runHeading ? runSheet(sectionText(p, runHeading)) : [];
  if (!workstreams.length)
    phases.forEach((ph, i) =>
      workstreams.push({
        ...base,
        id: id('workstream', `phase-${i}`),
        kind: 'workstream',
        title: ph.name,
        fields: { owner: null, status: ph.total && ph.done === ph.total ? 'Done' : ph.done ? 'In progress' : 'Not started', progress: ph.total ? Math.round((ph.done / ph.total) * 100) : null, next: ph.items.find((x) => !x.done) ? clean(itemParts(ph.items.find((x) => !x.done)!.what).what) : null, done: ph.done, total: ph.total, source: runHeading },
        links: [],
        ref: { at: 'phase', heading: runHeading, phase: i },
      }),
    );
  out.push(...workstreams);
  /** The workstream an action belongs to: its phase, else the one the shared matcher joins it to. */
  const workstreamFor = (text: string, phase?: string, future = true): WsRecord | undefined => {
    if (phase) return workstreams.find((w) => w.title === phase);
    const i = matchWorkstream(
      text,
      workstreams.map((w) => ({ name: w.title, done: DONE_WORDS.test(String(w.fields.status ?? '')) })),
      future,
    );
    return i >= 0 ? workstreams[i] : undefined;
  };

  // People: the People list, a contacts table, and people's notes that name the project.
  const people = new Map<string, WsRecord>();
  const addPerson = (rec: WsRecord) => {
    const k = norm(rec.title);
    if (!k) return;
    const had = people.get(k);
    if (!had) people.set(k, rec);
    else {
      for (const [f, v] of Object.entries(rec.fields)) if (had.fields[f] == null && v != null) had.fields[f] = v;
      // Somewhere to open: a real note wins over a link's words.
      if (rec.path && (!had.path || (!/\.md$/i.test(had.path) && /\.md$/i.test(rec.path)))) had.path = rec.path;
    }
  };
  p.people.forEach((x, i) => {
    const title = clean(x.name).replace(/\s*\(.*\)$/, '');
    if (!title) return;
    const linked = /\[\[([^\]|#]+)/.exec(x.role ?? '')?.[1] ?? /\[\[([^\]|#]+)/.exec(x.name)?.[1];
    addPerson({ ...base, id: id('person', `list-${i}`), kind: 'person', title, fields: { role: clean(x.role).replace(/\s*\(\s*[^)]*\)\s*$/, '') || null, company: null, contact: null, source: 'People' }, links: [], ref: { at: 'list', list: 'people', index: i }, ...(linked ? { path: linked.trim() } : {}) });
  });
  const contactsHeading = ['Suppliers and contacts', 'Contacts', 'Stakeholders'].find((h) => readTable(sectionText(p, h)));
  if (contactsHeading) {
    const t = readTable(sectionText(p, contactsHeading))!;
    const cols = { title: Math.max(0, column(t, /name|who|person/i)), role: column(t, /role|does|for/i), company: column(t, /company|org|organisation|organization|supplier/i), contact: column(t, /contact|email|phone|how/i) };
    const own: Record<string, number> = {};
    for (const [k, v] of Object.entries(cols)) if (v >= 0) own[k] = v;
    t.rows.forEach((row, i) => {
      const cell = (c: number) => (c >= 0 ? clean(row[c] ?? '') : '');
      if (!cell(cols.title)) return;
      addPerson({ ...base, id: id('person', `table-${i}`), kind: 'person', title: cell(cols.title), fields: { role: cell(cols.role) || null, company: cell(cols.company) || null, contact: cell(cols.contact) || null, source: contactsHeading }, links: [], ref: { at: 'table', heading: contactsHeading, row: i, cols: own } });
    });
  }

  // Actions: What's next, a run sheet's tick boxes.
  const actions: WsRecord[] = [];
  p.next.forEach((x, i) => {
    const what = clean(x.what);
    if (!what) return;
    const tail = whoAndWhen(x.who, x.when, today);
    const due = isoOf(tail.when, today);
    const ws = workstreamFor(what, undefined, !due || due >= isoDay(today));
    const meeting = /\[\[([^\]|#]*(?:meeting|review|call|catch|sync|alignment)[^\]|#]*)/i.exec(`${x.what} ${x.when ?? ''}`)?.[1];
    actions.push({
      ...base,
      id: id('action', `next-${i}`),
      kind: 'action',
      title: what,
      fields: { done: x.done, status: actionStatus(x.done, due, today), owner: ownerOf(tail.who) || null, due, when: clean(tail.when) || null, workstream: ws?.title ?? null, source: meeting ? clean(meeting) : 'What’s next' },
      links: ws ? [ws.id] : [],
      ref: { at: 'list', list: 'next', index: i },
    });
  });
  if (runHeading) {
    for (const ph of phases)
      for (const it of ph.items) {
        const parts = itemParts(it.what);
        const what = clean(parts.what);
        // (the same step in What's next and the run sheet: once, as the project hub shows it)
        if (!what || actions.some((a) => a.ref?.at === 'list' && alike(a.title, what))) continue;
        const due = isoOf(parts.when, today);
        const ws = workstreamFor(what, workstreams.some((w) => w.title === ph.name) ? ph.name : undefined, !due || due >= isoDay(today));
        actions.push({
          ...base,
          id: id('action', `run-${it.line}`),
          kind: 'action',
          title: what,
          fields: { done: it.done, status: actionStatus(it.done, due, today), owner: ownerOf(parts.who) || null, due, when: clean(parts.when) || null, workstream: ws?.title ?? ph.name, source: runHeading },
          links: ws ? [ws.id] : [],
          ref: { at: 'runsheet', heading: runHeading, line: it.line },
        });
      }
  }
  // Actions written in the project's meetings and notes: each once (one filed into What's next is the project's line).
  for (const c of input.connected ?? []) {
    const what = clean(c.what);
    if (!what || actions.some((a) => alike(a.title, what))) continue;
    const ws = workstreamFor(what, undefined, !c.due || c.due >= isoDay(today));
    actions.push({
      ...base,
      id: id('action', `elsewhere-${c.id}`),
      kind: 'action',
      title: what,
      fields: { done: c.done, status: actionStatus(c.done, c.due ?? null, today), owner: c.who ? ownerOf(c.who) || null : null, due: c.due ?? null, when: c.when ? clean(c.when) : null, workstream: ws?.title ?? null, source: c.from ?? 'A note' },
      links: ws ? [ws.id] : [],
      ref: { at: 'elsewhere', id: c.id, path: c.path, ...(c.line !== undefined ? { line: c.line } : {}), ...(c.task !== undefined ? { task: c.task } : {}) },
    });
  }
  out.push(...actions);

  // Milestones: Key dates.
  for (const m of milestones(p, today)) {
    if (m.index === undefined) continue;
    const ws = workstreamFor(m.what, undefined, !m.date || m.date >= isoDay(today));
    out.push({
      ...base,
      id: id('milestone', m.index),
      kind: 'milestone',
      title: clean(m.what),
      fields: { date: m.date ?? null, when: m.when || null, status: milestoneStatus(m.status, m.date, today), workstream: ws?.title ?? null, source: 'Key dates' },
      links: ws ? [ws.id] : [],
      ref: { at: 'list', list: 'dates', index: m.index },
    });
  }

  // Risks, decisions, updates.
  p.risks.forEach((r, i) => {
    const what = clean(r.what);
    if (!what) return;
    const status = r.closed ? 'Closed' : clean(r.status) ? cap(clean(r.status)) : 'Open';
    out.push({ ...base, id: id('risk', i), kind: 'risk', title: what, fields: { impact: cap(clean(r.level ?? (r.cells && p.risksHead ? r.cells[p.risksHead.findIndex((h) => /impact|level|severity/i.test(h))] : '') ?? '')) || null, owner: clean(r.owner) || null, status, closed: !!r.closed, source: 'Risks and issues' }, links: [], ref: { at: 'list', list: 'risks', index: i } });
  });
  p.decisions.forEach((d, i) => {
    const what = clean(d.what);
    if (!what) return;
    out.push({ ...base, id: id('decision', i), kind: 'decision', title: what, fields: { date: isoOf(d.date, today), why: clean(d.why) || null, source: 'Decisions' }, links: [], ref: { at: 'list', list: 'decisions', index: i } });
  });
  p.updates.forEach((u, i) => {
    const what = clean(u.what);
    if (!what) return;
    out.push({ ...base, id: id('update', i), kind: 'update', title: what, fields: { date: isoOf(u.date, today), from: clean(u.from) || null, words: what, source: 'Updates' }, links: [], ref: { at: 'list', list: 'updates', index: i } });
  });

  // Files: the ones listed in Documents (with what they are), and the folder's own when it can be read here.
  const seen: { target: string; rec: WsRecord }[] = [];
  p.documents.forEach((d, i) => {
    const target = d.link ? linkTarget(d.link) : d.path;
    const fileName = target.split('/').pop() ?? target;
    const isNote = !!d.link && !/\.[a-z0-9]{2,5}$/i.test(fileName);
    // The same file listed twice (a link and its path) is one file: the first, with what the second says if it says more.
    const dup = seen.find((s) => sameFile(s.target, target));
    if (dup) {
      if (!dup.rec.fields.what && d.what) dup.rec.fields.what = clean(d.what);
      return;
    }
    const ext = isNote ? 'md' : (/\.([a-z0-9]{2,5})$/i.exec(fileName)?.[1] ?? '').toLowerCase();
    const rec: WsRecord = {
      ...base,
      id: id('file', `doc-${i}`),
      kind: 'file',
      title: isNote ? fileName : fileName,
      ...(d.link ? { path: target } : {}),
      fields: { purpose: filePurpose(fileName, d.what ?? ''), type: ext ? ext.toUpperCase() : null, version: fileVersion(fileName), what: clean(d.what) || null, where: d.path.includes('/') ? folderOf(d.path) : null, modified: null, source: 'Documents' },
      links: [],
      ref: { at: 'list', list: 'documents', index: i },
    };
    seen.push({ target, rec });
    out.push(rec);
  });
  for (const f of input.files ?? []) {
    if (seen.some((s) => sameFile(s.target, f.rel))) continue;
    const rec: WsRecord = { ...base, id: id('file', `folder-${f.rel}`), kind: 'file', title: f.name, fields: { purpose: filePurpose(f.name), type: f.ext ? f.ext.replace(/^\./, '').toUpperCase() : null, version: fileVersion(f.name), what: null, where: folderOf(f.rel) || null, modified: f.modified ? isoDay(new Date(f.modified)) : null, source: 'Folder' }, links: [], ref: { at: 'file', rel: f.rel } };
    seen.push({ target: f.rel, rec });
    out.push(rec);
  }

  // Notes: meetings, people's notes, logs and the rest.
  const projectFolder = folderOf(path);
  for (const n of input.notes ?? []) {
    if (n.path === path) continue;
    const type = String(n.props.type ?? '').toLowerCase();
    if (type === 'log') continue;
    const inFolder = !!projectFolder && n.path.startsWith(`${projectFolder}/`);
    if (inFolder && n.path.split('/').slice(projectFolder.split('/').length).includes('Notebook')) continue;
    if (isPersonNote(n.path, n.props)) {
      addPerson({ ...base, id: id('person', `note-${n.path}`), kind: 'person', title: n.title, path: n.path, fields: { role: clean(n.props.role) || null, company: clean(n.props.org ?? n.props.company) || null, contact: clean(n.props.email ?? n.props.phone) || null, source: 'Person note' }, links: [], ref: { at: 'note', path: n.path } });
      continue;
    }
    if (isMeetingNote(n.path, n.props)) {
      const date = isoOf(String(n.props.date ?? ''), today) ?? isoOf(baseName(n.path).slice(0, 10), today) ?? isoDay(new Date(n.mtime));
      const named = Array.isArray(n.props.people) ? (n.props.people as unknown[]).map((x) => linkTarget(x)).filter(Boolean) : [];
      out.push({ ...base, id: id('meeting', n.path), kind: 'meeting', title: n.title, path: n.path, fields: { date, time: clean(n.props.time) || null, people: named.join(', ') || null, about: clean(n.props.description ?? n.props.about) || null, source: inFolder ? 'Project folder' : 'Meetings' }, links: [], ref: { at: 'note', path: n.path } });
      continue;
    }
    out.push({ ...base, id: id('note', n.path), kind: 'note', title: n.title, path: n.path, fields: { type: type ? cap(type) : 'Note', modified: isoDay(new Date(n.mtime)), about: clean(n.props.about ?? n.props.description) || null, source: inFolder ? 'Project folder' : 'Links here' }, links: [], ref: { at: 'note', path: n.path } });
  }
  out.push(...people.values());

  // The person's own tables (a register, a pipeline, campaigns, a plan): one record per row.
  const ownTables = p.extra.filter((x) => !/^(workstreams|run sheet|suppliers and contacts|contacts|stakeholders)$/i.test(x.heading.trim()) && readTable(x.body)?.head.length);
  for (const x of ownTables) {
    const t = readTable(x.body)!;
    const keys = t.head.map((h, i) => fieldKey(h) || `col${i + 1}`);
    const cols: Record<string, number> = {};
    // A numbering column ("#", "No.") isn't a row's name: the next column is.
    const first = /^(#|no\.?|n|num|number|item no\.?)$/i.test(t.head[0]?.trim() ?? '') || (t.rows.length > 1 && t.rows.every((r) => /^\d+\.?$/.test(clean(r[0] ?? '')))) ? 1 : 0;
    keys.forEach((k, i) => (cols[i === first ? 'title' : k] = i));
    t.rows.forEach((row, i) => {
      const title = clean(row[first] ?? '');
      if (!title) return;
      const fields: Record<string, FieldValue> = { table: x.heading.trim() };
      keys.forEach((k, j) => {
        if (j === first || (first === 1 && j === 0)) return;
        const raw = clean(row[j] ?? '');
        const num = /^-?[\d,]+(?:\.\d+)?%?$/.test(raw) ? Number(raw.replace(/[,%]/g, '')) : NaN;
        fields[k] = raw === '' ? null : Number.isFinite(num) ? num : (isoOf(raw, today) && /date|due|when|day/i.test(k) ? isoOf(raw, today) : raw);
      });
      out.push({ ...base, id: id('item', `${x.heading}-${i}`), kind: 'item', title, fields, links: [], ref: { at: 'table', heading: x.heading.trim(), row: i, cols } });
    });
  }

  // Log entries: one record per day logged, its numbers as fields.
  for (const log of input.logs ?? [])
    for (const e of log.entries) {
      const logPath = log.path ?? '';
      const fields: Record<string, FieldValue> = { date: e.date, log: log.title ?? baseName(logPath) };
      // The fields the log charts come first (a view's chart picks the first number field it finds).
      const charted = new Set(log.fields.map((f) => f.toLowerCase()));
      const values = Object.entries(e.values).sort(([a], [b]) => Number(charted.has(b.toLowerCase())) - Number(charted.has(a.toLowerCase())));
      for (const [k, v] of values) fields[fieldKey(k) || k] = v.kind === 'number' ? v.n : v.kind === 'yes' ? v.yes : v.text;
      out.push({ ...base, id: id('entry', `${logPath}#${e.date}`), kind: 'entry', title: e.label ? `${e.date} · ${e.label}` : e.date, ...(logPath ? { path: logPath } : {}), fields, links: [], ref: { at: 'log', path: logPath, date: e.date } });
    }

  joinRecords(out);
  return out;
}

/** A column heading as a field's key: "Next step" → "next_step", "Qty" → "qty". */
export function fieldKey(heading: string): string {
  return norm(heading).replace(/\s+/g, '_');
}
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** Records joined to each other: an action to its owner and workstream, a meeting to the people it names, a workstream
 *  to its owner. Links go both ways. */
export function joinRecords(records: WsRecord[]): void {
  const byPerson = new Map<string, WsRecord>();
  for (const r of records) if (r.kind === 'person') byPerson.set(norm(r.title), r);
  const link = (a: WsRecord, b: WsRecord | undefined) => {
    if (!b || a === b) return;
    if (!a.links.includes(b.id)) a.links.push(b.id);
    if (!b.links.includes(a.id)) b.links.push(a.id);
  };
  const byId = new Map(records.map((r) => [r.id, r]));
  for (const r of records) {
    for (const l of [...r.links]) link(r, byId.get(l));
    const owner = typeof r.fields.owner === 'string' ? r.fields.owner : '';
    if (owner) link(r, byPerson.get(norm(owner)));
    if (r.kind === 'meeting' && typeof r.fields.people === 'string') for (const n of r.fields.people.split(/,\s*/)) link(r, byPerson.get(norm(n)));
  }
}

/**
 * Records across the whole vault: every project's, and the meetings and people's notes outside them (once each).
 * `projects` are each project's input; `notes` every note in the vault.
 */
export function vaultRecords(projects: ProjectRecordsInput[], notes: RecordNote[], today: Date = new Date()): WsRecord[] {
  const out: WsRecord[] = [];
  const seen = new Set<string>();
  for (const p of projects)
    for (const r of projectRecords({ ...p, today })) {
      const k = r.path ? `${r.kind}:${r.path}` : r.id;
      if (r.path && seen.has(k)) continue;
      seen.add(k);
      out.push(r);
    }
  for (const n of notes) {
    const person = isPersonNote(n.path, n.props);
    const meeting = !person && isMeetingNote(n.path, n.props);
    if (!person && !meeting) continue;
    if (/^templates\//i.test(n.path)) continue;
    const kind: RecordKind = person ? 'person' : 'meeting';
    if (seen.has(`${kind}:${n.path}`)) continue;
    seen.add(`${kind}:${n.path}`);
    const projectName = linkTarget(n.props.project) || undefined;
    if (person) out.push({ id: `vault::person:${n.path}`, kind, title: n.title, path: n.path, ...(projectName ? { projectName } : {}), fields: { role: clean(n.props.role) || null, company: clean(n.props.org ?? n.props.company) || null, contact: clean(n.props.email ?? n.props.phone) || null, source: 'Person note' }, links: [], ref: { at: 'note', path: n.path } });
    else {
      const date = isoOf(String(n.props.date ?? ''), today) ?? isoOf(baseName(n.path).slice(0, 10), today) ?? isoDay(new Date(n.mtime));
      const named = Array.isArray(n.props.people) ? (n.props.people as unknown[]).map((x) => linkTarget(x)).filter(Boolean) : [];
      out.push({ id: `vault::meeting:${n.path}`, kind, title: n.title, path: n.path, ...(projectName ? { projectName } : {}), fields: { date, time: clean(n.props.time) || null, people: named.join(', ') || null, about: clean(n.props.description ?? n.props.about) || null, source: 'Meetings' }, links: [], ref: { at: 'note', path: n.path } });
    }
  }
  // People named the same across projects are one person in a vault-wide view: the note's record wins.
  const people = new Map<string, WsRecord>();
  const rest: WsRecord[] = [];
  for (const r of out) {
    if (r.kind !== 'person') {
      rest.push(r);
      continue;
    }
    const k = norm(r.title);
    const had = people.get(k);
    if (!had) people.set(k, r);
    else {
      const keep = had.path ? had : r.path ? r : had;
      const other = keep === had ? r : had;
      for (const [f, v] of Object.entries(other.fields)) if (keep.fields[f] == null && v != null) keep.fields[f] = v;
      const projects = new Set([...(String(keep.fields.projects ?? '').split(', ').filter(Boolean)), keep.projectName, other.projectName].filter(Boolean) as string[]);
      keep.fields.projects = [...projects].join(', ') || null;
      people.set(k, keep);
    }
  }
  for (const r of people.values()) if (r.fields.projects === undefined) r.fields.projects = r.projectName ?? null;
  const all = [...rest, ...people.values()];
  joinRecords(all);
  return all;
}

/** The notes that belong with a project: in its folder, or naming it (a `project:` property or a link). */
export function notesOfProject(path: string, name: string, notes: RecordNote[]): RecordNote[] {
  const folder = folderOf(path);
  const want = norm(name);
  const fileName = norm(baseName(path));
  return notes.filter((n) => {
    if (n.path === path) return false;
    if (folder && n.path.startsWith(`${folder}/`)) return true;
    const prop = norm(linkTarget(n.props.project));
    if (prop && (prop === want || prop === fileName)) return true;
    return (n.links ?? []).some((l) => {
      const t = norm(linkTarget(l).split('/').pop() ?? '');
      return t === want || t === fileName;
    });
  });
}
