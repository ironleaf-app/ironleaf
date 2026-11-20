// A project's workspace (24 Oct 2026, Workstream 1 part D). 23 Oct. The notebook view becomes the project's workspace: a
// left outline of sections (Overview, Plan, Actions and follow-ups, Meetings, Files, People, Risks and decisions,
// Updates, Notes, and the notebook's own Ask and Studio), each section a proper view over the project's records
// (src/shared/record-views.ts), in the order the person pins them, hidden or shown, with sections of their own (a saved
// view) and records dragged between sections where it means something. Structure comes from what a project holds, never
// from an AI: `autoWorkspace` makes the sections and their views from the records (meetings → a Meetings list;
// workstreams → a Plan board; files → a gallery by purpose; a register's table → a grid with counts; a log → a chart), so
// a project made by hand is well structured from its first minute. A new project starts by kind (programme, site or
// event, register, tracker, habit, venture, plain) with the same sections. The person's choices are a small JSON file in
// the vault (.neuralvault/workspaces/, src/main/workspaces.ts), so they sync with the notes and every PC shows the same
// workspace. Pure: no files, no window.

import { isoDay } from './days';
import { dayInStyle, itemParts, setRunSheetItem, setTableCell, toggleRunSheetItem, moveRunSheetItem, runSheet, sectionText } from './layouts';
import type { Project, ProjectEdit } from './project-file';
import { cleanRecordView, defaultFields, defaultRecordView, suggestChart, VIRTUAL, type RecordLayout, type RecordViewDef } from './record-views';
import { KIND_WORDS, type FieldValue, type RecordKind, type WsRecord } from './workspace-records';

export const WORKSPACE_FOLDER = '.neuralvault/workspaces';
export const VAULT_VIEWS_FOLDER = '.neuralvault/views';

// ── Sections ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export const BUILT_IN = ['overview', 'plan', 'actions', 'meetings', 'files', 'people', 'risks', 'updates', 'notes', 'ask'] as const;
export type BuiltInSection = (typeof BUILT_IN)[number];

export interface SectionInfo {
  id: BuiltInSection;
  title: string;
  /** What it is for, in a line (shown under its title, and when it is empty). */
  purpose: string;
  icon: string;
  kinds: RecordKind[];
  /** What "+ New" adds here (none: nothing is added from this section). */
  adds?: RecordKind[];
}

export const SECTIONS: Record<BuiltInSection, SectionInfo> = {
  overview: { id: 'overview', title: 'Overview', purpose: 'What needs you now, what’s next and what changed.', icon: 'home', kinds: [] },
  plan: { id: 'plan', title: 'Plan', purpose: 'Workstreams and milestones: how the work is split and when it lands.', icon: 'timeline', kinds: ['workstream', 'milestone'], adds: ['milestone'] },
  actions: { id: 'actions', title: 'Actions and follow-ups', purpose: 'Everything to do, who has it and by when.', icon: 'task', kinds: ['action'], adds: ['action'] },
  meetings: { id: 'meetings', title: 'Meetings', purpose: 'Meeting notes, with their people and what came out of them.', icon: 'calendar', kinds: ['meeting'] },
  files: { id: 'files', title: 'Files', purpose: 'Every file, by what it is for, with its version and where it came from.', icon: 'folder', kinds: ['file'] },
  people: { id: 'people', title: 'People', purpose: 'Who is involved, their role and how to reach them.', icon: 'people', kinds: ['person'], adds: ['person'] },
  risks: { id: 'risks', title: 'Risks and decisions', purpose: 'What could go wrong, who owns it, and what was decided.', icon: 'flag', kinds: ['risk', 'decision'], adds: ['risk', 'decision'] },
  updates: { id: 'updates', title: 'Updates', purpose: 'The project’s story: what happened, newest first.', icon: 'history', kinds: ['update'], adds: ['update'] },
  notes: { id: 'notes', title: 'Notes', purpose: 'The project’s own notes, and notes elsewhere about it.', icon: 'notes', kinds: ['note'] },
  ask: { id: 'ask', title: 'Ask and Studio', purpose: 'Questions answered only from the project’s notes and files, and things made from them.', icon: 'book', kinds: [] },
};

/** A section of the workspace: a built-in one, a table of the person's own ("table:Register"), the log, or a view they
 *  made (`custom:<id>`). */
export interface Section {
  id: string;
  title: string;
  purpose: string;
  icon: string;
  /** The views it shows, one under the other (Plan: workstreams, then milestones). */
  views: RecordViewDef[];
  /** How many records it holds (open ones for actions and risks), for the outline. */
  count: number;
  /** Something needs attention here (an overdue action, an open high risk). */
  alert?: number;
  /** Made by the person (renamed, removed). */
  custom?: boolean;
  pinned?: boolean;
  hidden?: boolean;
  /** Nothing in it yet: what to add says so. */
  empty?: boolean;
}

// ── Kinds of project ─────────────────────────────────────────────────────────────────────────────────────────────────

export const PROJECT_KINDS = ['programme', 'site', 'register', 'tracker', 'habit', 'venture', 'plain'] as const;
export type ProjectKind = (typeof PROJECT_KINDS)[number];
export interface KindInfo {
  id: ProjectKind;
  name: string;
  line: string;
  icon: string;
  /** The built-in project template it starts from (src/main/templates.ts). */
  template: string;
  /** Its sections in order (the rest hidden until wanted). */
  sections: string[];
}
export const KINDS: Record<ProjectKind, KindInfo> = {
  programme: { id: 'programme', name: 'Programme', line: 'Several workstreams with owners, milestones, risks and decisions.', icon: 'layers', template: 'project-layout-programme', sections: ['overview', 'plan', 'actions', 'meetings', 'risks', 'people', 'files', 'updates', 'notes', 'ask'] },
  site: { id: 'site', name: 'Site or event', line: 'A day to work towards: phases of jobs, suppliers and a countdown.', icon: 'flag', template: 'project-layout-site', sections: ['overview', 'plan', 'actions', 'people', 'files', 'risks', 'meetings', 'updates', 'notes', 'ask'] },
  register: { id: 'register', name: 'Register', line: 'A list of things kept up to date: equipment, contracts, licences.', icon: 'table', template: 'project-layout-register', sections: ['overview', 'table:Register', 'actions', 'files', 'updates', 'notes', 'ask'] },
  tracker: { id: 'tracker', name: 'Tracker', line: 'Numbers logged over time against a target: training, weight, sales.', icon: 'chart', template: 'project-layout-tracker', sections: ['overview', 'log', 'actions', 'notes', 'files', 'ask'] },
  habit: { id: 'habit', name: 'Habit', line: 'A daily yes or no, with a streak and how you felt.', icon: 'heart', template: 'project-layout-habit', sections: ['overview', 'log', 'actions', 'notes', 'ask'] },
  venture: { id: 'venture', name: 'Venture', line: 'Something you’re building: a pipeline, campaigns and the people in it.', icon: 'bulb', template: 'project-layout-venture', sections: ['overview', 'table:Pipeline', 'actions', 'people', 'files', 'updates', 'notes', 'ask'] },
  plain: { id: 'plain', name: 'Plain', line: 'Just the essentials: actions, files, notes and people. Add more as it grows.', icon: 'outline', template: 'project-blank', sections: ['overview', 'actions', 'files', 'people', 'notes', 'meetings', 'updates', 'ask'] },
};

/** The kind a project is, from its layout (a hand-made project without one is plain, or a programme when it has
 *  workstreams). */
export function kindOf(project: Pick<Project, 'layout' | 'extra'>): ProjectKind {
  switch ((project.layout ?? '').toLowerCase()) {
    case 'programme':
      return 'programme';
    case 'site':
      return 'site';
    case 'register':
      return 'register';
    case 'fitness':
    case 'tracker':
      return 'tracker';
    case 'wellbeing':
    case 'habit':
      return 'habit';
    case 'venture':
      return 'venture';
  }
  if (project.extra.some((x) => /^workstreams$/i.test(x.heading.trim()))) return 'programme';
  if (project.extra.some((x) => /^run sheet$/i.test(x.heading.trim()))) return 'site';
  return 'plain';
}

// ── The person's choices (the workspace file) ────────────────────────────────────────────────────────────────────────

export interface WorkspaceFile {
  version: 1;
  /** The project file it belongs to, as it was when last saved (renames are followed by the main side). */
  project: string;
  kind?: ProjectKind;
  /** Sections in the person's order (any not listed follow in the automatic order). */
  order: string[];
  pinned: string[];
  hidden: string[];
  /** A section's views as the person changed them (layout, grouping, filters…), by section id. */
  views: Record<string, RecordViewDef[]>;
  /** Sections renamed. */
  titles: Record<string, string>;
  /** Sections of their own: a saved view. */
  custom: { id: string; title: string; icon?: string; views: RecordViewDef[] }[];
  /** The section open last. */
  last?: string;
}

export function emptyWorkspace(project: string, kind?: ProjectKind): WorkspaceFile {
  return { version: 1, project, ...(kind ? { kind } : {}), order: [], pinned: [], hidden: [], views: {}, titles: {}, custom: [] };
}

const str = (v: unknown, max = 200) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
const strs = (v: unknown, max = 60) => (Array.isArray(v) ? [...new Set(v.map((x) => str(x)).filter((x): x is string => !!x))].slice(0, max) : []);
const SECTION_ID = /^(?:overview|plan|actions|meetings|files|people|risks|updates|notes|ask|log|table:.{1,80}|custom:[a-z0-9-]{1,40})$/;

/** The workspace file as the person (or another PC) left it: anything not understood is left out. */
export function readWorkspace(text: string, project: string): WorkspaceFile {
  let raw: unknown;
  try {
    raw = String(text ?? '').trim() ? JSON.parse(text) : {};
  } catch {
    return emptyWorkspace(project);
  }
  const r = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const ids = (v: unknown) => strs(v).filter((s) => SECTION_ID.test(s));
  const views: Record<string, RecordViewDef[]> = {};
  if (r.views && typeof r.views === 'object' && !Array.isArray(r.views))
    for (const [k, v] of Object.entries(r.views as Record<string, unknown>).slice(0, 40)) if (SECTION_ID.test(k) && Array.isArray(v)) views[k] = v.slice(0, 6).map(cleanRecordView);
  const titles: Record<string, string> = {};
  if (r.titles && typeof r.titles === 'object' && !Array.isArray(r.titles))
    for (const [k, v] of Object.entries(r.titles as Record<string, unknown>).slice(0, 40)) if (SECTION_ID.test(k) && str(v, 60)) titles[k] = str(v, 60)!;
  const custom = Array.isArray(r.custom)
    ? (r.custom as unknown[])
        .map((c) => (c && typeof c === 'object' ? (c as Record<string, unknown>) : null))
        .filter((c): c is Record<string, unknown> => !!c && SECTION_ID.test(String(c.id)) && String(c.id).startsWith('custom:') && !!str(c.title, 60))
        .slice(0, 30)
        .map((c) => ({ id: String(c.id), title: str(c.title, 60)!, ...(str(c.icon, 30) ? { icon: str(c.icon, 30) } : {}), views: (Array.isArray(c.views) ? c.views : []).slice(0, 6).map(cleanRecordView) }))
    : [];
  const kind = (PROJECT_KINDS as readonly string[]).includes(r.kind as string) ? (r.kind as ProjectKind) : undefined;
  return { version: 1, project: str(r.project, 600) ?? project, ...(kind ? { kind } : {}), order: ids(r.order), pinned: ids(r.pinned), hidden: ids(r.hidden), views, titles, custom, ...(str(r.last, 100) && SECTION_ID.test(String(r.last)) ? { last: str(r.last, 100) } : {}) };
}

/** The workspace file's words: readable, in a steady order. */
export function writeWorkspace(w: WorkspaceFile): string {
  const out: Record<string, unknown> = { version: 1, project: w.project };
  if (w.kind) out.kind = w.kind;
  out.order = w.order;
  out.pinned = w.pinned;
  out.hidden = w.hidden;
  if (Object.keys(w.titles).length) out.titles = w.titles;
  if (Object.keys(w.views).length) out.views = w.views;
  if (w.custom.length) out.custom = w.custom;
  if (w.last) out.last = w.last;
  return `${JSON.stringify(out, null, 2)}\n`;
}

/** The file a project's workspace is kept in, inside the vault: its path without ".md", folders joined by " » ". */
export function workspaceFileOf(projectPath: string): string {
  const base = projectPath
    .replace(/\\/g, '/')
    .replace(/\.md$/i, '')
    .split('/')
    .filter(Boolean)
    .map((s) => s.replace(/[<>:"|?*\x00-\x1f]/g, '_'))
    .join(' » ');
  return `${WORKSPACE_FOLDER}/${base || 'project'}.json`;
}

// ── Automatic structure ──────────────────────────────────────────────────────────────────────────────────────────────

const open = (r: WsRecord) => r.fields.done !== true && r.fields.closed !== true;

function view(kinds: RecordKind[], layout: RecordLayout, title: string, extra: Partial<RecordViewDef> = {}): RecordViewDef {
  return { ...defaultRecordView(kinds, layout, title), fields: defaultFields(kinds), ...extra };
}

/** The views a section starts with, made from what the records hold. */
export function autoViews(id: string, records: WsRecord[], prefer: string[] = []): RecordViewDef[] {
  const of = (k: RecordKind) => records.filter((r) => r.kind === k);
  switch (id) {
    case 'plan': {
      const ws = of('workstream');
      const out: RecordViewDef[] = [];
      if (ws.length) {
        const phases = ws.every((w) => w.ref?.at === 'phase');
        const statuses = new Set(ws.map((w) => String(w.fields.status ?? '')).filter(Boolean));
        out.push(phases ? view(['workstream'], 'gallery', 'Phases', { fields: ['progress', 'status', 'next'], showDone: true }) : statuses.size > 1 && ws.length > 3 ? view(['workstream'], 'board', 'Workstreams', { groupBy: 'status', showDone: true }) : view(['workstream'], 'gallery', 'Workstreams', { showDone: true }));
      }
      const ms = of('milestone');
      out.push(ms.filter((m) => m.fields.date).length >= 2 ? view(['milestone'], 'timeline', 'Milestones', { dateField: 'date', showDone: true }) : view(['milestone'], 'list', 'Milestones', { sort: { field: 'date', dir: 'asc' }, showDone: true }));
      return out;
    }
    case 'actions': {
      const acts = of('action');
      const grouped = acts.filter((a) => a.fields.workstream).length >= Math.max(2, acts.length / 2);
      return [view(['action'], 'list', 'Actions and follow-ups', grouped ? { groupBy: 'workstream', sort: { field: 'due', dir: 'asc' } } : { groupBy: VIRTUAL.when, sort: { field: 'due', dir: 'asc' } })];
    }
    case 'meetings':
      return [view(['meeting'], 'list', 'Meetings', { sort: { field: 'date', dir: 'desc' } })];
    case 'files': {
      const purposes = new Set(of('file').map((f) => f.fields.purpose));
      return [view(['file'], 'gallery', 'Files', purposes.size > 1 ? { groupBy: 'purpose' } : {})];
    }
    case 'people': {
      const ppl = of('person');
      const companies = new Set(ppl.map((p) => p.fields.company).filter(Boolean));
      return [view(['person'], 'gallery', 'People', companies.size > 1 ? { groupBy: 'company' } : {})];
    }
    case 'risks':
      return [view(['risk'], 'table', 'Risks and issues', { sort: { field: 'impact', dir: 'asc' } }), view(['decision'], 'list', 'Decisions', { sort: { field: 'date', dir: 'desc' } })];
    case 'updates':
      return [view(['update'], 'list', 'Updates', { sort: { field: 'date', dir: 'desc' } })];
    case 'notes':
      return [view(['note'], 'list', 'Notes', { sort: { field: 'modified', dir: 'desc' } })];
    case 'log': {
      const chart = suggestChart(records, ['entry'], prefer);
      return [view(['entry'], 'chart', 'Trend', { chart, fields: [], showDone: true }), view(['entry'], 'table', 'Entries', { sort: { field: 'date', dir: 'desc' }, fields: tableFields(records.filter((r) => r.kind === 'entry')).slice(0, 6), showDone: true })];
    }
  }
  if (id.startsWith('table:')) {
    const heading = id.slice(6);
    const rows = records.filter((r) => r.kind === 'item' && r.fields.table === heading);
    const fields = tableFields(rows);
    const values = (f: string) => new Set(rows.map((r) => String(r.fields[f] ?? '')).filter(Boolean)).size;
    const stage = fields.find((f) => /^(stage|status|state)$/.test(f) && values(f) > 1 && values(f) <= Math.max(6, rows.length / 2) && values(f) < rows.length);
    const filters = [{ field: 'table', op: 'is' as const, value: heading }];
    if (stage && /pipeline|campaign/i.test(heading)) return [view(['item'], 'board', heading, { groupBy: stage, fields: fields.filter((f) => f !== stage).slice(0, 3), filters, showDone: true })];
    return [view(['item'], 'table', heading, { fields, filters, showDone: true, ...(stage ? { groupBy: stage } : {}) })];
  }
  return [];
}

/** The fields rows of a table have, in the table's order. */
function tableFields(rows: WsRecord[]): string[] {
  const keys: string[] = [];
  for (const r of rows) for (const k of Object.keys(r.fields)) if (k !== 'table' && k !== 'log' && !keys.includes(k)) keys.push(k);
  return keys;
}

/** The sections a project has, made from what it holds, in the order its kind reads it. Sections with nothing in them
 *  are hidden on an existing project (the person can show them), shown on a new one of a kind that uses them. */
export function autoSections(records: WsRecord[], project: Pick<Project, 'layout' | 'extra'>, kind?: ProjectKind, props: Record<string, unknown> = {}, now: Date = new Date()): Section[] {
  const k = kind ?? kindOf(project);
  const prefer = Object.keys(props)
    .map((key) => /^(?:start|target)_(.+)$/i.exec(key)?.[1])
    .filter((x): x is string => !!x)
    .map((x) => x.toLowerCase().replace(/[^a-z0-9]+/g, '_'));
  const ownTables = [...new Set(records.filter((r) => r.kind === 'item').map((r) => String(r.fields.table)))].map((t) => `table:${t}`);
  const hasLog = records.some((r) => r.kind === 'entry');
  const order = [...KINDS[k].sections];
  for (const t of ownTables) if (!order.includes(t)) order.splice(Math.max(1, order.indexOf('actions')), 0, t);
  if (hasLog && !order.includes('log')) order.splice(1, 0, 'log');
  for (const id of BUILT_IN) if (!order.includes(id)) order.splice(order.indexOf('ask') >= 0 ? order.indexOf('ask') : order.length, 0, id);
  return order.map((id) => sectionFor(id, records, !!kind, prefer, now));
}

function sectionFor(id: string, records: WsRecord[], fresh: boolean, prefer: string[] = [], now: Date = new Date()): Section {
  const built = (SECTIONS as Record<string, SectionInfo>)[id];
  const views = autoViews(id, records, prefer);
  const kinds = built?.kinds ?? (id === 'log' ? ['entry'] : id.startsWith('table:') ? ['item'] : []);
  const mine = id.startsWith('table:') ? records.filter((r) => r.kind === 'item' && r.fields.table === id.slice(6)) : records.filter((r) => kinds.includes(r.kind));
  const counted = id === 'actions' || id === 'risks' ? mine.filter(open) : mine;
  const today = isoDay(now);
  const alert = id === 'actions' ? mine.filter((r) => open(r) && typeof r.fields.due === 'string' && r.fields.due < today).length : id === 'risks' ? mine.filter((r) => r.kind === 'risk' && open(r) && /high|critical/i.test(String(r.fields.impact ?? ''))).length : 0;
  const always = id === 'overview' || id === 'ask' || id === 'actions' || id === 'files' || id === 'notes';
  // A table of the person's own named like a section ("## Plan" in a tracker) says it is the table.
  const own = id.startsWith('table:') ? id.slice(6) : '';
  const title = built?.title ?? (id === 'log' ? 'Log' : Object.values(SECTIONS).some((x) => x.title.toLowerCase() === own.toLowerCase()) ? `${own} table` : own);
  const purpose = built?.purpose ?? (id === 'log' ? 'Every entry, charted over time.' : `The rows of ${title}, kept in the project file.`);
  const icon = built?.icon ?? (id === 'log' ? 'chart' : 'table');
  return { id, title, purpose, icon, views, count: counted.length, ...(alert ? { alert } : {}), empty: !always && mine.length === 0, hidden: !always && !fresh && mine.length === 0 };
}

/**
 * The workspace as the person sees it: the automatic sections with their choices over them (order, pins, hidden,
 * renamed, views changed), and their own sections. New automatic sections (a first meeting) appear in their place.
 */
export function resolveWorkspace(records: WsRecord[], project: Pick<Project, 'layout' | 'extra'>, file: WorkspaceFile | null, props: Record<string, unknown> = {}, now: Date = new Date()): Section[] {
  const w = file ?? emptyWorkspace('');
  const auto = autoSections(records, project, w.kind, props, now);
  const fresh = !!w.kind;
  const all: Section[] = [
    ...auto.map((s) => {
      const views = w.views[s.id]?.length ? w.views[s.id] : s.views;
      // Hidden by the person, or automatically (empty) unless the person showed it (listed in its order with no hide).
      const shown = w.order.includes(s.id) && !w.hidden.includes(s.id);
      return { ...s, title: w.titles[s.id] ?? s.title, views, hidden: w.hidden.includes(s.id) || (s.hidden && !shown && !fresh), pinned: w.pinned.includes(s.id) };
    }),
    ...w.custom.map((c) => {
      const kinds = [...new Set(c.views.flatMap((v) => v.kinds))];
      return { id: c.id, title: c.title, purpose: 'A view of your own.', icon: c.icon ?? 'views', views: c.views, count: records.filter((r) => kinds.includes(r.kind) && ((r.kind !== 'action' && r.kind !== 'risk') || open(r))).length, custom: true, pinned: w.pinned.includes(c.id), hidden: w.hidden.includes(c.id) } as Section;
    }),
  ];
  const autoIndex = new Map(all.map((s, i) => [s.id, i]));
  const rank = (s: Section) => {
    const i = w.order.indexOf(s.id);
    return i >= 0 ? i : 1000 + (autoIndex.get(s.id) ?? 0);
  };
  // Pinned first (in the person's order), then the rest; Overview stays on top unless the person moved it.
  return all.sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || rank(a) - rank(b));
}

/** The workspace with a section moved before another (or to the end), the full order written so it stays. */
export function moveSection(w: WorkspaceFile, sections: Section[], id: string, before: string | null): WorkspaceFile {
  const ids = sections.map((s) => s.id).filter((s) => s !== id);
  const at = before ? ids.indexOf(before) : -1;
  ids.splice(at >= 0 ? at : ids.length, 0, id);
  return { ...w, order: ids };
}
export function pinSection(w: WorkspaceFile, id: string, pinned: boolean): WorkspaceFile {
  return { ...w, pinned: pinned ? [...new Set([...w.pinned, id])] : w.pinned.filter((x) => x !== id) };
}
/** Hidden or shown; showing a section writes it into the order so an empty automatic one stays shown. */
export function hideSection(w: WorkspaceFile, sections: Section[], id: string, hidden: boolean): WorkspaceFile {
  const order = w.order.length ? w.order : sections.map((s) => s.id);
  return { ...w, hidden: hidden ? [...new Set([...w.hidden, id])] : w.hidden.filter((x) => x !== id), order: order.includes(id) ? order : [...order, id] };
}
export function renameSection(w: WorkspaceFile, id: string, title: string): WorkspaceFile {
  const t = title.replace(/\s+/g, ' ').trim().slice(0, 60);
  if (id.startsWith('custom:')) return { ...w, custom: w.custom.map((c) => (c.id === id ? { ...c, title: t || c.title } : c)) };
  const titles = { ...w.titles };
  if (t) titles[id] = t;
  else delete titles[id];
  return { ...w, titles };
}
export function setSectionViews(w: WorkspaceFile, id: string, views: RecordViewDef[]): WorkspaceFile {
  if (id.startsWith('custom:')) return { ...w, custom: w.custom.map((c) => (c.id === id ? { ...c, views } : c)) };
  return { ...w, views: { ...w.views, [id]: views } };
}
/** A section of the person's own from a view; its id made from its title. */
export function addCustomSection(w: WorkspaceFile, title: string, v: RecordViewDef): { file: WorkspaceFile; id: string } {
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 30) || 'view';
  let id = `custom:${slug}`;
  for (let n = 2; w.custom.some((c) => c.id === id); n++) id = `custom:${slug}-${n}`;
  return { file: { ...w, custom: [...w.custom, { id, title: title.trim().slice(0, 60) || 'My view', views: [{ ...v, title: title.trim().slice(0, 60) || v.title }] }], order: w.order.length ? [...w.order, id] : w.order }, id };
}
export function removeCustomSection(w: WorkspaceFile, id: string): WorkspaceFile {
  return { ...w, custom: w.custom.filter((c) => c.id !== id), order: w.order.filter((x) => x !== id), pinned: w.pinned.filter((x) => x !== id), hidden: w.hidden.filter((x) => x !== id) };
}
/** A section's views back to the ones made from what it holds. */
export function resetSection(w: WorkspaceFile, id: string): WorkspaceFile {
  const views = { ...w.views };
  delete views[id];
  const titles = { ...w.titles };
  delete titles[id];
  return { ...w, views, titles };
}

// ── Changing a record where it lives ─────────────────────────────────────────────────────────────────────────────────

/** The fields a person can change on a record (the rest are worked out or read only). */
export function editableFields(r: WsRecord): string[] {
  const ref = r.ref;
  if (!ref) return [];
  if (ref.at === 'list')
    switch (ref.list) {
      case 'next':
        return ['title', 'owner', 'due', 'status', 'done'];
      case 'dates':
        return ['title', 'date', 'status'];
      case 'risks':
        return ['title', 'impact', 'owner', 'status'];
      case 'decisions':
        return ['title', 'date', 'why'];
      case 'updates':
        return ['title', 'date', 'from'];
      case 'people':
        return ['title', 'role'];
      case 'documents':
        return ['what'];
    }
  if (ref.at === 'runsheet') return ['title', 'owner', 'due', 'status', 'done'];
  if (ref.at === 'table') return Object.keys(ref.cols);
  // A meeting's tick box is ticked where it is written; its words stay the meeting's.
  if (ref.at === 'elsewhere') return ref.task !== undefined ? ['done'] : [];
  return [];
}

/** Who an item is for with its owner changed, the rest of what was written kept ("Jesse with Jay Lu" → "Ana with Jay Lu"). */
function whoWith(written: string, owner: string, next: string): string {
  if (owner && written.includes(owner)) return written.replace(owner, next).replace(/^\s*(?:with|and|&|,|·)\s+/, '').trim();
  return next;
}

/** A value as the project file writes it: a day in the style its neighbours use. */
function dayText(iso: string, like: string[]): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? dayInStyle(iso, like.filter(Boolean)) : iso;
}

/**
 * One change to one field of a record, as the project edit that makes it (one line, one cell, one property; every other
 * character kept). Null when the field can't be changed there.
 */
export function recordEdit(p: Project, r: WsRecord, field: string, value: FieldValue): ProjectEdit | null {
  const ref = r.ref;
  const v = value === null || value === undefined ? '' : String(value).trim();
  if (!ref || !editableFields(r).includes(field)) return null;
  if (ref.at === 'list') {
    const i = ref.index;
    switch (ref.list) {
      case 'next': {
        if (field === 'done' || field === 'status') return { kind: 'change', list: 'next', index: i, item: { done: field === 'done' ? value === true || /^(yes|true|done)$/i.test(v) : /^done$/i.test(v) } };
        const line = p.next[i];
        if (field === 'title') return { kind: 'change', list: 'next', index: i, item: { what: v } };
        if (field === 'owner') return { kind: 'change', list: 'next', index: i, item: { who: whoWith(line?.who ?? '', String(r.fields.owner ?? ''), v) } };
        // A day written among the names ("Ana · Fri 23 Oct, 11:00 AM") is changed where it is.
        const day = v ? dayText(v, p.next.map((n) => n.when ?? '')) : '';
        // (only the day's own words: a time or a note after a comma stays as written)
        const dayWords = String(r.fields.when ?? '').split(/\s*[,(]/)[0];
        if (!line?.when && dayWords && line?.who?.includes(dayWords)) return { kind: 'change', list: 'next', index: i, item: { who: line.who.replace(dayWords, day).replace(/\s+·\s*(?=,|$)/, '') } };
        return { kind: 'change', list: 'next', index: i, item: { when: day } };
      }
      case 'dates':
        return { kind: 'change', list: 'dates', index: i, item: { [field === 'title' ? 'what' : field === 'date' ? 'when' : 'status']: field === 'date' && v ? dayText(v, p.dates.map((d) => d.when)) : v } };
      case 'risks':
        if (field === 'status') return { kind: 'change', list: 'risks', index: i, item: p.risksHead ? { status: v } : { closed: /^(closed|done|resolved)/i.test(v) } };
        return { kind: 'change', list: 'risks', index: i, item: { [field === 'title' ? 'what' : field === 'impact' ? 'level' : 'owner']: field === 'impact' ? v.toLowerCase() : v } };
      case 'decisions':
        return { kind: 'change', list: 'decisions', index: i, item: { [field === 'title' ? 'what' : field]: field === 'date' && v ? dayText(v, p.decisions.map((d) => d.date ?? '')) : v } };
      case 'updates':
        return { kind: 'change', list: 'updates', index: i, item: { [field === 'title' ? 'what' : field]: field === 'date' && v ? dayText(v, p.updates.map((d) => d.date ?? '')) : v } };
      case 'people':
        return { kind: 'change', list: 'people', index: i, item: { [field === 'title' ? 'name' : 'role']: v } };
      case 'documents':
        return { kind: 'describe', path: p.documents[i]?.path ?? '', what: v };
    }
  }
  if (ref.at === 'runsheet') {
    const body = sectionText(p, ref.heading);
    if (!body) return null;
    let next = body;
    if (field === 'done' || field === 'status') next = toggleRunSheetItem(body, ref.line, field === 'done' ? value === true || /^(yes|true|done)$/i.test(v) : /^done$/i.test(v));
    else {
      const was = itemParts(/^\s*[-*+]\s+\[[ xX]\]\s+(.*)$/.exec(body.split(/\r?\n/)[ref.line] ?? '')?.[1] ?? '');
      next = setRunSheetItem(body, ref.line, field === 'title' ? { what: v } : field === 'owner' ? { who: whoWith(was.who, String(r.fields.owner ?? ''), v) } : { when: v ? dayText(v, []) : '' });
    }
    if (next === body) return null;
    return { kind: 'section', heading: ref.heading, body: next, words: field === 'done' || field === 'status' ? (/^done$|^true$|^yes$/i.test(v) || value === true ? `Ticked off “${r.title}”.` : `Put “${r.title}” back on the list.`) : `Changed “${r.title}”.` };
  }
  if (ref.at === 'table') {
    const col = ref.cols[field];
    const body = sectionText(p, ref.heading);
    if (col === undefined || !body) return null;
    const next = setTableCell(body, ref.row, col, v);
    if (next === body) return null;
    return { kind: 'section', heading: ref.heading, body: next, words: `Set ${r.title}’s ${field === 'title' ? 'name' : field.replace(/_/g, ' ')}${v ? ` to ${v}` : ''}.` };
  }
  return null;
}

// ── Dragging records between sections, or onto each other ────────────────────────────────────────────────────────────

export interface DropPlan {
  /** What it does, in words (shown while dragging over, and in the message after). */
  words: string;
  edits: ProjectEdit[];
}

/**
 * What dropping a record somewhere means, or null where it means nothing. Onto a record: an action onto a workstream
 * makes it that workstream's next step (or moves a run sheet's action into that phase); an action onto a milestone
 * makes it due that day; a person onto an action or workstream makes them its owner. Onto a section: an action becomes a
 * risk, a risk becomes an action to deal with it, an action or decision is logged as an update.
 */
export function dropPlan(p: Project, r: WsRecord, target: { record?: WsRecord; section?: string }, today: Date = new Date()): DropPlan | null {
  const t = target.record;
  if (t && t.id !== r.id) {
    if (r.kind === 'action' && t.kind === 'workstream') {
      if (r.ref?.at === 'runsheet' && t.ref?.at === 'phase' && r.ref.heading === t.ref.heading) {
        const body = sectionText(p, r.ref.heading);
        const phases = runSheet(body);
        const phase = phases[t.ref.phase];
        if (!phase || r.fields.workstream === phase.name) return null;
        const last = phase.items[phase.items.length - 1];
        const moved = last ? moveRunSheetItem(body, r.ref.line, last.line, true).body : insertUnderHeading(body, r.ref.line, phase.line);
        return moved === body ? null : { words: `Move to ${phase.name}`, edits: [{ kind: 'section', heading: r.ref.heading, body: moved, words: `Moved “${r.title}” to ${phase.name}.` }] };
      }
      if (t.ref?.at === 'table' && t.ref.cols.next !== undefined) {
        const e = recordEdit(p, t, 'next', r.title);
        return e ? { words: `Make it ${t.title}’s next step`, edits: [e] } : null;
      }
      return null;
    }
    if (r.kind === 'action' && t.kind === 'milestone' && typeof t.fields.date === 'string') {
      const e = recordEdit(p, r, 'due', t.fields.date);
      return e ? { words: `Due by ${t.title}`, edits: [e] } : null;
    }
    if (r.kind === 'person' && (t.kind === 'action' || t.kind === 'workstream' || t.kind === 'risk')) {
      const e = recordEdit(p, t, 'owner', r.title);
      return e ? { words: `Give it to ${r.title}`, edits: [e] } : null;
    }
    return null;
  }
  const s = target.section;
  if (!s) return null;
  const date = dayInStyle(isoDay(today), p.updates.map((u) => u.date ?? '').filter(Boolean));
  if (r.kind === 'action' && s === 'risks') return { words: 'Raise it as a risk', edits: [{ kind: 'add', list: 'risks', item: { what: r.title, ...(r.fields.owner ? { owner: String(r.fields.owner) } : {}), ...(p.risksHead ? { status: 'Open' } : {}) } }] };
  if (r.kind === 'risk' && s === 'actions') return { words: 'Make an action to deal with it', edits: [{ kind: 'add', list: 'next', item: { what: `Deal with: ${r.title}`, ...(r.fields.owner ? { who: String(r.fields.owner) } : {}) } }] };
  if ((r.kind === 'action' || r.kind === 'decision' || r.kind === 'milestone') && s === 'updates') {
    const what = r.kind === 'action' ? (r.fields.done ? `Done: ${r.title}` : `Under way: ${r.title}`) : r.kind === 'milestone' ? `${r.title} (${String(r.fields.status ?? 'milestone').toLowerCase()})` : `Decided: ${r.title}`;
    return { words: 'Log it as an update', edits: [{ kind: 'add', list: 'updates', item: { what, date }, at: 0 }] };
  }
  if (r.kind === 'risk' && s === 'updates') return { words: 'Log it as an update', edits: [{ kind: 'add', list: 'updates', item: { what: `Risk: ${r.title}`, date }, at: 0 }] };
  if (r.kind === 'milestone' && s === 'actions') return { words: 'Make an action for it', edits: [{ kind: 'add', list: 'next', item: { what: r.title, ...(r.fields.date ? { when: dayText(String(r.fields.date), p.next.map((n) => n.when ?? '')) } : {}) } }] };
  return null;
}

/** A run sheet's words with a tick box moved straight under a phase heading (an empty phase). */
function insertUnderHeading(body: string, line: number, heading?: number): string {
  if (heading === undefined) return body;
  const lines = body.split(/\r?\n/);
  const [box] = lines.splice(line, 1);
  const at = heading > line ? heading : heading + 1;
  let i = at;
  while (i < lines.length && !lines[i].trim()) i++;
  lines.splice(i > at && lines[at - 1]?.startsWith('###') ? at + 1 : at, 0, box);
  return lines.join('\n');
}

// ── Adding a record from a section ───────────────────────────────────────────────────────────────────────────────────

/** The edit that adds a new record of a kind (its first words given), or null for kinds not kept in the project file. */
export function addRecordEdit(p: Project, kind: RecordKind, words: string, today: Date = new Date()): ProjectEdit | null {
  const what = words.replace(/\s+/g, ' ').trim();
  if (!what) return null;
  const day = (like: string[]) => dayInStyle(isoDay(today), like.filter(Boolean));
  switch (kind) {
    case 'action':
      return { kind: 'add', list: 'next', item: { what } };
    case 'milestone':
      return { kind: 'add', list: 'dates', item: { what, when: day(p.dates.map((d) => d.when)) } };
    case 'risk':
      return { kind: 'add', list: 'risks', item: { what, ...(p.risksHead ? { status: 'Open' } : { level: 'medium' }) } };
    case 'decision':
      return { kind: 'add', list: 'decisions', item: { what, date: day(p.decisions.map((d) => d.date ?? '')) }, at: 0 };
    case 'update':
      return { kind: 'add', list: 'updates', item: { what, date: day(p.updates.map((u) => u.date ?? '')) }, at: 0 };
    case 'person':
      return { kind: 'add', list: 'people', item: { name: what } };
  }
  return null;
}

/** Words for a section's count in the outline ("4 open", "12"). */
export function countWords(s: Section): string {
  if (s.id === 'overview' || s.id === 'ask') return '';
  return s.count ? String(s.count) : '';
}

export const kindNoun = (k: RecordKind) => KIND_WORDS[k].one.toLowerCase();
