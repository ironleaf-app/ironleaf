// What other AI apps do in Ironleaf (the vault's tools, the local MCP server and the side chat's catalogue): the tools
// they call (src/shared/agent-access.ts lists them), Settings › Connect an AI's switch and level, and "What agents did"
// with Undo. The local MCP server (src/main/mcp-local.ts, "ironleaf mcp" and the local URL) calls asLocalMcp; the side
// chat calls asOwn; the ironleaf command and links call asPerson.
//
// Every change goes through the same steps as the person's own: a project through the project page's edit (its history
// says which agent), a note through the normal write (File recovery keeps its versions). Private notes, settings, saved
// passwords, keys and the licence are never reachable: no tool reads them, and note paths in the Private notes folder are
// refused. Kept in Ironleaf's own data (agents.json for Connect an AI's choice, agent-activity.json), never in the notes.

import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, promises as fsp, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { AgentTools, alreadyAppended, nearProjectRefusal, readNoteFile, sameTitleNote, type AgentHost } from './agent';
import { runFullTool, undoFull, type FullDone, type FullHost, type FullKit, type FullUndo } from './agent-full';
import { AgentUploads, decodeBase64, deliver, type AgentFilesHost, type Delivered } from './agent-files';
import { CHUNK_BYTES, MAX_FILE_BYTES, ONE_CALL_TEXT, CHUNK_CHARS, bytesWords, extOf, safeFileName, safeSubfolder, type DeliveredFile } from '../shared/agent-files';
import type { VaultIndex } from './indexer';
import {
  ASSET_LIMIT,
  ASSET_MAX,
  BATCH_LIMIT,
  DEFAULT_LOCAL_MCP,
  EMPTY_NOTE,
  FILE_SEARCH_LIMIT,
  FILE_SEARCH_MAX,
  LIST_LIMIT,
  LIST_MAX,
  RECENT_DAYS,
  RECENT_LIMIT,
  RECENT_MAX,
  SEARCH_LIMIT,
  SEARCH_MAX,
  cleanLocalMcp,
  capText,
  changeCount,
  partOf,
  toolDef,
  type ActivityOutcome,
  type ActivityView,
  type AgentLevel,
  type AgentToolDef,
  type AgentsState,
  type LocalMcpHttpView,
  type LocalMcpSettings,
  type McpTool,
} from '../shared/agent-access';
import { LOCAL_MCP_ID, LOCAL_MCP_LEFT_OUT, LOCAL_MCP_NAME, LOCAL_MCP_OFF, LOCAL_MCP_READONLY, localLevelAllows, localMcpCatalogue, localMcpDef, mcpToolOf } from '../shared/mcp-local';
import { runMcpTool, type McpToolsHost } from './mcp-tools';
import { isPrivatePath } from '../shared/private';
import type { Area } from '../shared/areas';
import type { BrandKit } from '../shared/assets';
import { brandContent, brandDocument } from '../shared/brand-document';
import { DESIGN_FORMATS, isDesignFormat, kindInfo as designKindInfo, type DesignFormat } from '../shared/design-doc';
import type { DesignStart } from './design-studio';
import { kitForNote } from '../shared/brand-kits';
import { readProps } from '../shared/frontmatter';
import { answerRecordTool } from '../shared/records';
import { guardBillFreeText } from '../shared/record-module-tools';
import { ConsentNeeded, gateAccessHost, type Gate } from './agent-gate';
import { refusal, type Level } from '../shared/sensitivity';
import { renderRowFromTableTexts, splitRowPath, type SystemsTableKind } from '../shared/system-tables';
import { makeRowResolver } from './life-records/system-tables';
import { renderBillRowFromTableText, splitBillRow } from '../shared/bills-table';
import { makeBillRowResolver } from './bills-tables';
import { isProjectProps, isProjectText, type Project, type ProjectEdit, type ProjectList } from '../shared/project-file';
import { inFolder } from '../shared/paths';
import { closeBlockedWords, openProjectTasks } from '../shared/project-close';
import { findProblems, isoDay, KIND_WORDS, projectTimeline, todayDay } from '../shared/timeline';
import { findActions, isMeetingNote, meetingDate, notePeople } from '../shared/meetings';
import { appendUnder, captureLines, captureNotePath, noteText, parseDue, planCapture, taskLine } from '../shared/capture';
import { formatDate } from '../shared/dates';
import { INBOX_NOTE } from '../shared/inbox';
import { alreadyThereWords, normalizeTaskWhat, taskPointerLine } from '../shared/task-write';
import type { TodayData } from '../shared/today';
import { planNextAdds, plannedEdits, plannedWords, routeNoteTask, updateNoteTaskLine, writeNoteUpdates } from './task-write';
import type { TemplateInfo } from '../shared/templates';
import type { ProjectCard, ProjectView } from '../shared/types';
import { served, OWN_ASKER, type OwnConsumer } from '../shared/vault-tools';
import { filterTasks, findAllTasks, setTaskDue, type TaskFilter, type TaskStatus, type TaskWhen, type VaultTask } from '../shared/tasks';
import type { CalendarToday } from '../shared/calendar';
import { readDay } from '../shared/today';
import { localMcpUnderPolicy } from './policy';
import { audit } from './enterprise';

/** The longest a next step and an update may be (characters, about 25 and 50 words): short lines a person can scan. */
const STEP_MAX = 160;
const UPDATE_MAX = 350;

export type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

/** What the agent layer needs from Ironleaf (src/main/app.ts gives it; the tests give made-up notes). */
export interface AgentAccessHost {
  /** Life modules' tools (Wave 5; src/main/modules.ts): offered while each module is on, every call through the agent's gate. */
  modules?: { tools(): AgentToolDef[]; call(gate: Gate, name: string, args: Record<string, unknown>): Promise<{ text: string; done?: { words: string } }> };
  dataDir: string;
  kind: 'standalone' | 'embedded';
  /** Ironleaf's notes opened when they aren't yet. */
  ready(): Promise<void>;
  /** The folder of notes open now (Undo only in the one a change was made in). */
  library(): string | null;
  index: VaultIndex;
  /** The chat assistant's own way into the notes (src/main/agent.ts): agents use its readers, never its writers. */
  notes: AgentHost;
  projects(): ProjectCard[];
  projectView(rel: string): ProjectView;
  allProjects(): { path: string; version: string; project: Project }[];
  /** A change to a project through the project page's own edit; `by` goes in its history ("Claude Desktop (agent)"). */
  editProject(rel: string, edits: ProjectEdit[], by: string, words?: string): Promise<{ file: string; words: string; before: string; after: string }>;
  /** A project change taken back: the page's own Undo when it is the last step there, else the file written back. */
  undoProject(file: string, step: { before: string; after: string }, words: string): Promise<void>;
  /** A new project file (from a project template when given); its path. */
  createProject(name: string, template?: string): Promise<string>;
  writeNote(rel: string, text: string): Promise<void>;
  trash(rel: string): Promise<void>;
  today(): TodayData;
  dailyPath(): string;
  dailyNote(): Promise<string>;
  freeNote(folder: string, title: string): Promise<string>;
  prefs(): { captureNoProject: 'daily' | 'inbox'; timeFormat: string; templatesFolder: string };
  /** The vault's areas of life (a note's own brand kit is its area's); none when the vault isn't organised by area. */
  areas?(): Area[];
  templates(): TemplateInfo[];
  lastReview(): Promise<number | null>;
  /** The person's name ("Sam"), when Ironleaf can tell. */
  person(): string | null;
  /** Full control: what an agent may do beyond reading and adding (notes and folders, templates, canvases, assets…). */
  full?: FullHost;
  /** Where files agents make for a project (or a note) are saved (project_save_file, note_attach_file). */
  files?: AgentFilesHost;
  /** A branded document printed to a PDF (note_to_pdf): the same hidden window Export to PDF prints through
   *  (src/main/brand-print.ts) — its bytes and its true page count. */
  brandPrint?(html: string): Promise<{ pdf: Buffer; pages: number }>;
  /** A note designed by the person's AI into a finished PDF (design_document; src/main/design-studio.ts). */
  design?(input: DesignStart, format: DesignFormat): Promise<{ data: Buffer; ext: string; pages: number; problems: string[] }>;
  /** Connect an AI or What agents did changed: the window reads them again. */
  changed(): void;
  log?(message: string): void;
  /** Sensitivity levels (src/main/agent-gate.ts): the gate one agent's calls go through (who: "agent:<id>"). */
  gate?(who: string, name: string): Gate;
  // What files_find, tasks_list and calendar_get read (8.0 V1/TR3/V6; src/shared/agent-reach.ts).
  /** Every file Ironleaf keeps, with its record (src/main/vault-files.ts catalogue). */
  fileCatalogue?(): Promise<FileFound[]>;
  /** Every task across the notes (src/main/tasks.ts). */
  tasks?(): { today: string; tasks: VaultTask[] };
  /** Short texts to the on-device meaning model's vectors (null: the model is off — the write check stays exact). */
  embed?(texts: string[]): Promise<number[][] | null>;
  /** Today's calendar (src/main/calendar.ts). */
  calendar?(): Promise<CalendarToday>;
  /** What the MCP-only tools read (File recovery's versions, bookmarks) and the local URL's view (src/main/mcp-http.ts). */
  mcp?: McpToolsHost & { httpView?(): LocalMcpHttpView | undefined; command?(): string | null };
  /** The weekly tidy (src/main/weekly-tidy.ts): its waiting lines and applying one. */
  tidy?: {
    list(): Promise<{ id: string; title: string; detail: string }[]>;
    apply(id: string): Promise<string>;
  };
}

/** A file Ironleaf keeps, as files_find reads it (the parts of vault-files.ts's CatalogueItem it uses). */
export interface FileFound {
  path: string;
  name: string;
  folder: string;
  size: number;
  mtime: number;
  kind: string;
  title: string;
  summary?: string;
  what: string;
  source?: { by: string; how: string; from?: string; at: string };
  added?: string;
  record?: string;
  area?: string;
  version: number;
  ref?: { path: string; missing: boolean };
}

/** Who a call is for: the local MCP server ("Other AI apps"), the side chat, or the person themself. */
interface Caller {
  id: string;
  name: string;
  level: AgentLevel;
}

/** What Settings › Connect an AI keeps in agents.json. Anything else an earlier version kept there is left as it is. */
interface StoreFile {
  localMcp?: LocalMcpSettings;
}
/** A file an agent saved (taken back to the Bin only while it is as the agent left it). */
type FileSavedUndo = { kind: 'file-saved'; abs: string; size: number; mtime: number; library?: string; note?: { path: string; before: string; after: string } };

type Undo =
  | FileSavedUndo
  | { kind: 'project'; file: string; before: string; after: string }
  | { kind: 'note-made'; path: string; text: string }
  | { kind: 'note-edited'; path: string; before: string; after: string }
  | { kind: 'note-deleted'; path: string; text: string }
  | FullUndo;

interface ActivityEntry {
  id: string;
  at: number;
  agentId: string;
  agentName: string;
  tool: string;
  words: string;
  project?: { path: string; name: string };
  note?: string;
  outcome: ActivityOutcome;
  library: string | null;
  undo?: Undo;
  undone?: boolean;
  /** A file the agent delivered: where it is, and its one line on what it is; and whether the person looked at it. */
  file?: SavedFile;
  seen?: boolean;
}

interface SavedFile {
  name: string;
  size: number;
  place: 'folder' | 'library';
  path: string;
  abs: string;
  mtime: number;
  what?: string;
  remoteName?: string;
  replaced?: boolean;
}

/** What a tool did, for "What agents did". */
interface Done {
  words: string;
  file?: SavedFile;
  project?: { path: string; name: string };
  note?: string;
  undo?: Undo;
  outcome?: ActivityOutcome;
}


/** The calls being carried out for an agent, each with its own gated way into the vault (src/main/agent-gate.ts). */
const callAgent = new AsyncLocalStorage<{ host: AgentAccessHost; gate: Gate }>();

const PRIVATE = 'Private notes are never open to agents.';
// The person's own command line and ironleaf:// links (21 Oct 2026, gap G26; src/main/external.ts): the verbs they may
// use, run as the person (no level, approvals or log of an agent's).
const PERSON_TOOLS = ['vault_search', 'note_read', 'notes_list', 'notes_recent', 'note_create', 'note_append'];
const PERSON: Caller = { id: 'person', name: 'You', level: 'edit' };
const DAY = 86_400_000;
const MAX_ACTIVITY = 400;
/** Undo data is kept for the newest changes only (each holds the text before and after). */
const UNDO_KEPT = 80;
const UNDO_TEXT = 400_000;
const NOUN: Record<ProjectList, [string, string]> = { next: ['next step', 'next steps'], dates: ['key date', 'key dates'], people: ['person', 'people'], risks: ['risk', 'risks'], decisions: ['decision', 'decisions'], updates: ['update', 'updates'], documents: ['document', 'documents'] };

const str = (v: unknown, max = 2000): string => (typeof v === 'string' ? v.slice(0, max) : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');
const num = (v: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
};
// Why there is no calendar, in the person's words (the calendar card's own reasons, src/shared/calendar.ts).
const CALENDAR_WHY: Record<string, string> = { 'not-set-up': 'No calendar is connected yet.', 'not-offered': 'No calendar is offered here.', 'signed-out': 'Google is signed out.', 'needs-sign-in': 'Google needs signing in again to read the calendar.', 'calendar-off': 'The calendar is switched off.', unavailable: 'The calendar couldn’t be read just now.' };
const text = (t: string, isError = false): ToolResult => ({ content: [{ type: 'text', text: t }], ...(isError ? { isError: true } : {}) });
const json = (v: unknown) => JSON.stringify(v, (_k, x) => (x === '' || x === null ? undefined : x));
const localDay = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const titleOf = (rel: string) => (rel.split('/').pop() ?? rel).replace(/\.md$/i, '');
// Whole words: activity, approvals and errors wrap where they show (t207 pass 2).
const quote = (s: string, _max = 70) => `“${s}”`;
/** A task line for the Inbox: a day in its words becomes the one plain 📅 day (p12-task-writes: real dates only). */
const inboxTaskLine = (what: string): string => {
  const due = parseDue(what, new Date());
  return due ? setTaskDue(`- [ ] ${due.rest}`, due.iso) : `- [ ] ${what}`;
};
const lineWords = (list: ProjectList, x: Record<string, unknown>): string =>
  list === 'dates' ? `${str(x.when)}: ${str(x.what)}` : list === 'people' ? `${str(x.name)}${x.role ? ` (${str(x.role)})` : ''}` : list === 'documents' ? str(x.path) : str(x.what);
/** A project line's identity for adding, normalised (case, punctuation and spacing): the same line said again is
 *  the same line. '' when there is nothing to match on (never deduped). */
const lineIdentity = (list: ProjectList, x: Record<string, unknown>): string => {
  const plain = (v: unknown) => str(v, 1000).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
  if (list === 'next') {
    const what = plain(x.what);
    return what ? `${what}|${plain(x.who)}` : '';
  }
  if (list === 'dates') {
    const id = `${plain(x.when)}|${plain(x.what)}`;
    return id === '|' ? '' : id;
  }
  if (list === 'people') return plain(x.name);
  if (list === 'documents') return str(x.path, 600).toLowerCase().replace(/\\/g, '/').replace(/\/+$/, '');
  return plain(x.what);
};

export class AgentAccess {
  private data: StoreFile = {};
  /** agents.json as it was read: what earlier versions kept there is written back unchanged beside Connect an AI's choice. */
  private stored: Record<string, unknown> = {};
  private activity: ActivityEntry[] = [];
  /** Notes each agent has read (agent and path): a same-title create goes ahead only after a read. Bounded. */
  private reads = new Map<string, number>();
  private saving: Promise<void> = Promise.resolve();
  /** Files agents send in parts, part-way (src/main/agent-files.ts). */
  readonly uploads: AgentUploads;

  /** Ironleaf as a call reaches it: through the gate of the agent whose call it is (every read and change in this
   *  class goes through this), else Ironleaf itself (the window's own requests, Undo). */
  private get host(): AgentAccessHost {
    return callAgent.getStore()?.host ?? this.base;
  }

  constructor(private base: AgentAccessHost) {
    this.uploads = new AgentUploads(path.join(base.dataDir, 'agent-uploads'), Date.now, (m) => base.log?.(m));
  }

  private get storeFile() {
    return path.join(this.host.dataDir, 'agents.json');
  }
  private get activityFile() {
    return path.join(this.host.dataDir, 'agent-activity.json');
  }

  /** Reads Connect an AI's choice and what agents did from Ironleaf's data. */
  load(): void {
    try {
      const v = JSON.parse(readFileSync(this.storeFile, 'utf8')) as unknown;
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        this.stored = v as Record<string, unknown>;
        this.data = { localMcp: cleanLocalMcp(this.stored.localMcp) };
      }
    } catch {
      // None yet.
    }
    try {
      const v = JSON.parse(readFileSync(this.activityFile, 'utf8'));
      // Lines about conversations with agents that connected through another app (sent, replied, started) are left out.
      this.activity = (Array.isArray(v) ? v : []).filter((e: ActivityEntry) => e && typeof e.id === 'string' && typeof e.at === 'number' && !['sent', 'replied', 'started'].includes(String(e.outcome))).slice(0, MAX_ACTIVITY);
    } catch {
      // None yet.
    }
  }

  private write(file: string, value: unknown): Promise<void> {
    const next = this.saving.then(async () => {
      await fsp.mkdir(path.dirname(file), { recursive: true });
      const temp = `${file}.${process.pid}.tmp`;
      await fsp.writeFile(temp, JSON.stringify(value), 'utf8');
      await fsp.rename(temp, file);
    });
    this.saving = next.catch((err) => this.host.log?.(`Agents: could not save (${err instanceof Error ? err.message : String(err)})`));
    return this.saving;
  }
  private saveStore() {
    return this.write(this.storeFile, { ...this.stored, ...this.data });
  }
  private saveActivity() {
    return this.write(this.activityFile, this.activity);
  }
  /** Saving finished (the tests wait for it). */
  flush(): Promise<void> {
    return this.saving;
  }

  private changed(): void {
    this.host.changed();
  }


  // ── The person's own command line and links (21 Oct 2026, gap G26) ──

  /** One of the verbs agents use, run for the person themself from the ironleaf command or a ironleaf:// link they
   *  allowed (src/main/external.ts): the same note finding and writes, never Private notes, and nothing waiting for
   *  approval or logged as an agent's (it is their own doing; File recovery keeps every note's earlier version). */
  async asPerson(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    if (!PERSON_TOOLS.includes(name)) return text(`There is no command for ${name}.`, true);
    try {
      await this.host.ready();
      return text((await this.dispatch(PERSON, name, args)).text);
    } catch (err) {
      return text(err instanceof Error ? err.message : String(err), true);
    }
  }

  /**
   * One call from Ironleaf's own AI (8.0 V1, the one catalogue, src/shared/vault-tools.ts): the side chat. The same tools
   * and handlers other AI apps have, each call through its own gate (Settings › Privacy and secrets); nothing goes in What
   * agents did, since the person is talking with it and its replies show what changed, with Undo.
   */
  async asOwn(who: { id: string; name: string; consumer: OwnConsumer }, gate: Gate | null, name: string, rawArgs: unknown): Promise<ToolResult> {
    // Only Ironleaf's own askers; an outside agent's id ("agent:…") never comes in this way.
    if (!OWN_ASKER.test(who.id) || who.id.startsWith('agent:')) return text('That asker isn’t known to Ironleaf.', true);
    const def = toolDef(name);
    if (!def || !served(who.consumer, def)) return text(`There is no Ironleaf tool called ${name}.`, true);
    const rec: Caller = { id: who.id, name: who.name, level: 'full' };
    const args = rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs) ? (rawArgs as Record<string, unknown>) : {};
    try {
      await this.host.ready();
      const out = gate ? await callAgent.run({ host: gateAccessHost(this.base, gate), gate }, () => this.dispatch(rec, def.name, args)) : await this.dispatch(rec, def.name, args);
      return text(capText(out.text));
    } catch (err) {
      return text(err instanceof Error ? err.message : String(err), true);
    }
  }

  /** A note that is there, by its path or title, found as agents find it (never a Private note); `write` also refuses a
   *  project's file, which changes on its page so the change is kept in its history. Throws in words. */
  personNote(raw: string, write = false): string {
    const rel = this.existingNote(raw);
    if (write) this.writableNote(rel);
    return rel;
  }

  // ── The window: Settings › Connect an AI and What agents did ─────────────────────────────────────────────────────────

  async state(): Promise<AgentsState> {
    return {
      host: this.host.kind,
      activity: this.activity.slice(0, 120).map((e) => this.activityView(e)),
      person: this.person(),
      delivered: this.deliveredFiles(),
      localMcp: this.localMcpSettings(),
      ...(this.host.mcp?.httpView?.() ? { localMcpHttp: this.host.mcp.httpView() } : {}),
      ...(this.host.mcp?.command?.() ? { localMcpCommand: this.host.mcp.command()! } : {}),
    };
  }

  /** Other AI apps on this PC (the local MCP server): off, Read only, until the person chooses. */
  localMcpSettings(): LocalMcpSettings {
    return localMcpUnderPolicy(cleanLocalMcp(this.data.localMcp ?? DEFAULT_LOCAL_MCP));
  }

  private localMcpWatchers = new Set<(s: LocalMcpSettings) => void>();
  /** Told each time the person changes Connect an AI (the local URL starts and stops with it). */
  onLocalMcpChange(fn: (s: LocalMcpSettings) => void): () => void {
    this.localMcpWatchers.add(fn);
    return () => this.localMcpWatchers.delete(fn);
  }

  /** The person's choice for other AI apps, kept (Settings › Connect an AI). */
  async setLocalMcp(patch: unknown): Promise<AgentsState> {
    const now = this.localMcpSettings();
    const p = (patch && typeof patch === 'object' ? patch : {}) as Partial<LocalMcpSettings>;
    this.data.localMcp = cleanLocalMcp({ on: p.on ?? now.on, level: p.level ?? now.level, http: p.http ?? now.http, port: p.port ?? now.port });
    await this.saveStore();
    const s = this.localMcpSettings();
    for (const fn of this.localMcpWatchers) {
      try {
        fn(s);
      } catch (err) {
        this.host.log?.(`Connect an AI: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    this.changed();
    return this.state();
  }

  /** The tools other AI apps are offered now: the catalogue at the person's level (Read only: the read tools; Read and write:
   *  every tool, never jobs), plus each switched-on pack's record tools at that level (no jobs). Listed even while off
   *  (the read ones), so set-up reads right; calls are refused until switched on. */
  localMcpTools(): McpTool[] {
    const s = this.localMcpSettings();
    const level = s.on ? s.level : 'read';
    const fixed = localMcpCatalogue()
      .filter((d) => localLevelAllows(level, d))
      .map(mcpToolOf);
    const mods = (this.host.modules?.tools() ?? [])
      .filter((t) => !LOCAL_MCP_LEFT_OUT.has(t.name) && !fixed.some((f) => f.name === t.name) && localLevelAllows(level, t))
      .map(mcpToolOf);
    return [...fixed, ...mods];
  }

  /** The notes as MCP resources (ironleaf://note/<path>), Private notes never among them; none while off. */
  localMcpResources(max = 2000): { uri: string; name: string; title: string; mimeType: string }[] {
    if (!this.localMcpSettings().on) return [];
    return this.base.index
      .allMeta()
      .filter((m) => !isPrivatePath(m.path) && /\.md$/i.test(m.path))
      .slice(0, max)
      .map((m) => ({ uri: `ironleaf://note/${m.path.split('/').map(encodeURIComponent).join('/')}`, name: m.path, title: m.title || m.path, mimeType: 'text/markdown' }));
  }

  /** One note resource read (through note_read's own path: the gate and Private notes honoured). */
  async readLocalMcpResource(uri: string): Promise<{ uri: string; mimeType: string; text: string }> {
    const m = /^(?:ironleaf|neuralvault):\/\/note\/(.+)$/.exec(String(uri ?? '')); // neuralvault://: the name before the rename, still read
    if (!m) throw new Error('That is not an Ironleaf note address.');
    const rel = m[1].split('/').map((x) => decodeURIComponent(x)).join('/');
    const r = await this.asLocalMcp('note_read', { path: rel });
    const words = r.content.map((c) => c.text).join('\n');
    if (r.isError) throw new Error(words);
    return { uri, mimeType: 'text/markdown', text: words };
  }

  /** One call from another AI app on this PC (the local MCP server, "ironleaf mcp" or the local URL): the same
   *  dispatch agents use, through its own gate (Settings › Privacy and secrets: Open and Work until the person changes
   *  Outside agents), Private notes never reached, File recovery keeping every version, every change logged in What
   *  agents did with Undo, and nothing waiting for the person (deletes go to the Bin with Undo; no jobs; a
   *  Family-private photo is refused rather than asked about). */
  async asLocalMcp(name: unknown, rawArgs: unknown): Promise<ToolResult> {
    const s = this.localMcpSettings();
    if (!s.on) return text(LOCAL_MCP_OFF, true);
    const tool = typeof name === 'string' ? name.trim().slice(0, 120) : '';
    const fixed = localMcpDef(tool);
    const mod = !fixed ? this.host.modules?.tools().find((t) => t.name === tool) : undefined;
    const def = fixed ?? mod;
    if (!def) return text(`There is no tool called ${tool || 'that'}.`, true);
    if (LOCAL_MCP_LEFT_OUT.has(def.name)) return text('That tool is not available to other AI apps.', true);
    if (!localLevelAllows(s.level, def)) return text(LOCAL_MCP_READONLY, true);
    // The same batch limit as every other door (9.2 seam): no card waits here, so it is refused in words.
    const checkedArgs = rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs) ? (rawArgs as Record<string, unknown>) : {};
    if (changeCount(def, checkedArgs) > BATCH_LIMIT) return text(`That is more than ${BATCH_LIMIT} changes in one call. Split it into smaller calls.`, true);
    const args = checkedArgs;
    // Read and write reaches the Full control tools (notes and folders, templates, canvases…): the person chose it here.
    const rec: Caller = { id: LOCAL_MCP_ID, name: LOCAL_MCP_NAME, level: s.level === 'edit' ? 'full' : 'read' };
    try {
      await this.host.ready();
      const gate = this.gateOf(rec);
      const run = async (): Promise<{ text: string; done?: Done }> => {
        const extra = await runMcpTool(
          {
            index: this.host.index,
            host: this.host.mcp,
            note: (raw) => this.existingNote(raw),
            writable: (rel) => this.writableNote(rel),
            read: (rel) => this.host.notes.read(rel),
            write: (rel, t) => this.host.writeNote(rel, t),
            move: (from, to) => this.dispatch(rec, 'note_move', { from, to }),
          },
          tool,
          args,
        );
        return (extra as { text: string; done?: Done } | null) ?? this.dispatch(rec, tool, args);
      };
      const out = gate ? await callAgent.run({ host: gateAccessHost(this.base, gate), gate }, run) : await run();
      if (out.done) this.log(rec, tool, out.done);
      return text(capText(out.text));
    } catch (err) {
      if (err instanceof ConsentNeeded) return text('That photo needs your OK in Ironleaf first, each time it is used.', true);
      return text(err instanceof Error ? err.message : String(err), true);
    }
  }

  /** Files agents delivered in the last two weeks, newest first (each with whether it is still where it was saved). */
  deliveredFiles(days = 14, max = 40): DeliveredFile[] {
    const since = Date.now() - days * DAY;
    const out: DeliveredFile[] = [];
    for (const e of this.activity) {
      if (e.at < since) break;
      if (!e.file || e.undone || e.outcome !== 'done') continue;
      out.push(this.fileView(e));
      if (out.length >= max) break;
    }
    return out;
  }

  private fileView(e: ActivityEntry): DeliveredFile {
    const f = e.file!;
    return {
      id: e.id,
      at: e.at,
      agentName: e.agentName,
      name: f.name,
      ext: extOf(f.name),
      size: f.size,
      ...(f.what ? { what: f.what } : {}),
      place: f.place,
      path: f.path,
      abs: f.abs,
      ...(e.project ? { project: e.project } : {}),
      ...(e.note ? { note: e.note } : {}),
      ...(f.remoteName ? { remoteName: f.remoteName } : {}),
      ...(f.replaced ? { replaced: true } : {}),
      exists: e.library === this.host.library() && existsSync(f.abs),
      seen: !!e.seen,
    };
  }


  /** A delivered file looked at (opened, or put away). */
  async seenFile(id: unknown): Promise<void> {
    const e = this.activity.find((x) => x.id === id && !!x.file);
    if (!e || e.seen) return;
    e.seen = true;
    await this.saveActivity();
    this.changed();
  }


  /** Takes back a change an agent made (only on the file as that change left it). */
  async undo(id: unknown): Promise<string> {
    const e = this.activity.find((x) => x.id === id);
    if (!e?.undo || e.undone) return 'That can’t be undone.';
    if (e.library !== this.host.library()) return 'That change was made in another folder of notes: open it to undo.';
    await this.host.ready();
    const u = e.undo;
    const content = (rel: string) => this.host.index.content(rel);
    const since = `${e.agentName}’s change was left as it is, because it was changed since. Earlier versions are in File recovery.`;
    if (u.kind === 'project') {
      if (content(u.file) !== u.after) return since;
      await this.host.undoProject(u.file, { before: u.before, after: u.after }, `Undid ${e.agentName}’s change: ${e.words.replace(/\.$/, '').toLowerCase()}`);
    } else if (u.kind === 'note-made') {
      const now = content(u.path);
      if (now !== undefined && now !== u.text) return since;
      if (now !== undefined) await this.host.trash(u.path);
    } else if (u.kind === 'note-edited') {
      if (content(u.path) !== u.after) return since;
      await this.host.writeNote(u.path, u.before);
    } else if (u.kind === 'file-saved') {
      const st = await fsp.stat(u.abs).catch(() => null);
      if (!st) return 'That file isn’t where it was saved any more (moved or deleted), so there is nothing to take back.';
      if (st.size !== u.size || Math.abs(st.mtimeMs - u.mtime) > 2000) return `${e.agentName}’s file was left as it is, because it was changed since.`;
      if (!this.host.files) return 'That can’t be undone here.';
      await this.host.files.trashFile(u.abs);
      if (u.library) await this.host.files.addedToLibrary(u.library).catch(() => {});
      if (u.note && content(u.note.path) === u.note.after) await this.host.writeNote(u.note.path, u.note.before);
    } else if (u.kind === 'note-deleted') {
      if (await this.host.notes.exists(u.path)) return 'A note with that name is there now, so the deleted one wasn’t brought back. It is in File recovery.';
      await this.host.writeNote(u.path, u.text);
    } else {
      if (!this.host.full) return 'That can’t be undone here.';
      const why = await undoFull(u, { host: this.host.full, noteExists: (rel) => this.host.notes.exists(rel) }, e.agentName);
      if (why) return why;
    }
    e.undone = true;
    await this.saveActivity();
    this.changed();
    return `Undone: ${e.words.charAt(0).toLowerCase()}${e.words.slice(1).replace(/\.$/, '')}.`;
  }

  // ── Inside ──────────────────────────────────────────────────────────────────────────────────────────────────────────

  private person(): string | null {
    try {
      return this.host.person();
    } catch {
      return null;
    }
  }

  private fullKit(rec: Caller): FullKit {
    if (!this.host.full) throw new Error('Full control’s tools need the Ironleaf app (they aren’t available here).');
    const h = this.host;
    return {
      host: h.full!,
      content: (rel) => (isPrivatePath(rel) ? undefined : h.index.content(rel)),
      readNote: async (rel) => {
        if (isPrivatePath(rel)) throw new Error(PRIVATE);
        return h.notes.read(rel);
      },
      noteExists: (rel) => h.notes.exists(rel),
      writeNote: (rel, t) => {
        if (isPrivatePath(rel)) throw new Error(PRIVATE);
        return h.writeNote(rel, t);
      },
      dailyNote: () => h.dailyNote(),
      findProject: (raw) => this.findProject(raw),
      projectNamed: (name) => h.projects().some((c) => c.name.toLowerCase() === name.toLowerCase()),
      titleBlocked: (rel) => this.sameTitleRefusal(rec.id, rel),
      projectView: (rel) => h.projectView(rel) as unknown as ReturnType<FullKit['projectView']>,
      existingNote: (raw) => this.existingNote(raw),
      cleanNote: (raw) => this.cleanNote(raw),
      cleanPath: (raw) => this.cleanPath(raw),
      writableNote: (rel) => this.writableNote(rel),
      editProject: async (card, edits, words) => (await this.editProject(rec, card, edits, words)) as { text: string; done: FullDone },
      reader: (name, args) => this.reader(name, args),
      ...(h.notes.markBillPaid ? { markBillPaid: (rel: string, day: string) => h.notes.markBillPaid!(rel, day) } : {}),
      guarded: () => ({ never: [h.dataDir, ...(h.kind === 'embedded' ? [path.dirname(h.dataDir)] : [])], library: h.library() }),
    };
  }

  /** Any path inside the library (a note, file or folder), never Private notes. */
  private cleanPath(raw: unknown): string {
    const given = str(raw, 600).trim();
    if (isPrivatePath(given)) throw new Error(PRIVATE);
    const rel = given ? this.host.notes.clean(given) : '';
    if (given && !rel) throw new Error('Give a path inside the library, such as "Clients/Harbour Lane".');
    if (isPrivatePath(rel) || /(^|\/)\.neuralvault(\/|$)/i.test(rel)) throw new Error(PRIVATE);
    return rel;
  }

  private activityView(e: ActivityEntry): ActivityView {
    return { id: e.id, at: e.at, agentId: e.agentId, agentName: e.agentName, tool: e.tool, words: e.words, ...(e.project ? { project: e.project } : {}), ...(e.note ? { note: e.note } : {}), outcome: e.outcome, canUndo: !!e.undo && !e.undone && e.outcome === 'done' && e.library === this.host.library(), undone: !!e.undone, ...(e.file && !e.undone ? { file: this.fileView(e) } : {}) };
  }

  private log(rec: { id: string; name: string }, tool: string, done: Done): void {
    // A quote ending its own sentence ends the line: "…as a PDF.”" (not "…PDF.”.").
    const words = done.words.replace(/([.!?])”([.:])$/, '$1”');
    const entry: ActivityEntry = { id: randomUUID(), at: Date.now(), agentId: rec.id, agentName: rec.name, tool, words, ...(done.project ? { project: done.project } : {}), ...(done.note ? { note: done.note } : {}), ...(done.file ? { file: done.file } : {}), outcome: done.outcome ?? 'done', library: this.host.library() };
    if (done.undo && JSON.stringify(done.undo).length <= UNDO_TEXT) entry.undo = done.undo;
    this.activity.unshift(entry);
    // The organisation's audit trail (src/main/enterprise.ts): which agent, which tool, how it ended; never a note.
    if (rec.id !== PERSON.id) audit({ kind: 'agent.access', actor: rec.name, outcome: entry.outcome === 'expired' ? 'denied' : entry.outcome, detail: { agent: rec.id, tool } });
    if (this.activity.length > MAX_ACTIVITY) this.activity.length = MAX_ACTIVITY;
    let kept = 0;
    for (const x of this.activity) if (x.undo && ++kept > UNDO_KEPT) delete x.undo;
    void this.saveActivity();
    this.changed();
  }

  /** The agent's id for its sensitivity row: "agent:<id>" (the local MCP server: "agent:local-mcp"); none for the
   *  person's own command line, which is theirs. */
  private whoOf(rec: Caller): string | null {
    if (rec.id === PERSON.id) return null;
    return `agent:${rec.id}`;
  }

  private gateOf(rec: Caller): Gate | null {
    const who = this.whoOf(rec);
    return who && this.base.gate ? this.base.gate(who, rec.name) : null;
  }

  /** The assistant's readers (src/main/agent.ts), never its writers, and never in Private notes. */
  private readers(): AgentTools {
    const h = this.host.notes;
    const refuse = async (): Promise<never> => {
      throw new Error('Agents change notes with their own tools.');
    };
    // The library's index without Private notes (Ironleaf never indexes them; kept out here as well).
    const whole = this.host.index;
    const index = new Proxy(whole, {
      get(target, prop) {
        if (prop === 'allMeta') return () => target.allMeta().filter((m) => !isPrivatePath(m.path));
        if (prop === 'search') return (q: string, limit?: number, lines?: number) => target.search(q, limit, lines).filter((x) => !isPrivatePath(x.path));
        if (prop === 'get') return (p: string) => (isPrivatePath(p) ? undefined : target.get(p));
        if (prop === 'content') return (p: string) => (isPrivatePath(p) ? undefined : target.content(p));
        if (prop === 'resolve') return (t: string, from?: string) => {
          const r = target.resolve(t, from);
          return r && isPrivatePath(r) ? null : r;
        };
        const v = Reflect.get(target, prop, target);
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });
    const host: AgentHost = {
      ...h,
      index,
      read: async (rel) => {
        if (isPrivatePath(rel)) throw new Error(PRIVATE);
        return h.read(rel);
      },
      listing: async () => {
        const l = await h.listing();
        return { files: l.files.filter((f) => !isPrivatePath(f.rel)), folders: l.folders.filter((f) => !isPrivatePath(f)) };
      },
      write: refuse,
      makeFolder: refuse,
      move: refuse,
      trash: refuse,
      send: undefined,
      // Agents never bin or tick through the assistant's tools (their own deleting tools wait for the person).
      bin: undefined,
      tasks: undefined,
      // Agents never write in projects' folders through the assistant's tools.
      fileWrites: undefined,
    };
    return new AgentTools(host, [], () => {});
  }

  private async reader(name: string, args: Record<string, unknown>): Promise<string> {
    const r = await this.readers().run({ id: randomUUID(), name, arguments: JSON.stringify(args) });
    if (r.isError) throw new Error(r.text);
    return r.text;
  }

  // ── Names the agent gives ──

  private findProject(raw: unknown): ProjectCard {
    const named = str(raw, 300).trim();
    if (!named) throw new Error('Give the project’s name (projects_list has them).');
    const cards = this.host.projects();
    const low = named.toLowerCase().replace(/\.md$/i, '');
    const exact = cards.find((c) => c.name.toLowerCase() === low || c.path.toLowerCase().replace(/\.md$/i, '') === low);
    if (exact) return exact;
    const some = cards.filter((c) => c.name.toLowerCase().includes(low));
    if (some.length === 1) return some[0];
    if (some.length > 1) throw new Error(`Several projects match “${named}”: ${some.slice(0, 10).map((c) => c.name).join(', ')}. Say which.`);
    const gate = callAgent.getStore()?.gate;
    const hidden = gate ? this.base.projects().find((c) => c.name.toLowerCase() === low || c.path.toLowerCase().replace(/\.md$/i, '') === low) : undefined;
    if (hidden) gate!.check(hidden.path);
    throw new Error(`There is no project called “${named}”. The projects: ${cards.slice(0, 30).map((c) => c.name).join(', ') || 'none yet'}.`);
  }

  /** Notes this agent has read go down (a same-title create goes ahead only after one). Oldest fall off past 2000. */
  private noteReadBy(agentId: string, rel: string): void {
    this.reads.set(`${agentId}|${rel.toLowerCase()}`, Date.now());
    while (this.reads.size > 2000) {
      const first = this.reads.keys().next();
      if (first.done) break;
      this.reads.delete(first.value);
    }
  }

  /** Refusing a new note for a same-title one the agent hasn't read (null: no such note, or read already). */
  private sameTitleRefusal(agentId: string, rel: string): string | null {
    const same = sameTitleNote(this.host.index.allMeta(), rel);
    if (!same || this.reads.has(`${agentId}|${same.path.toLowerCase()}`)) return null;
    return `There is already “${same.title}” at ${same.path}. Read it first (note_read): when it is the note you mean, use note_append or note_replace; a new note only when nothing fits.`;
  }

  private listOf(raw: unknown, allowed: ProjectList[] = ['next', 'dates', 'risks', 'decisions', 'people', 'documents', 'updates']): ProjectList {
    if (typeof raw === 'string' && (allowed as string[]).includes(raw)) return raw as ProjectList;
    throw new Error(`list is one of ${allowed.join(', ')}.`);
  }

  private lineIndex(p: Project, list: ProjectList, raw: unknown): number {
    const items = p[list] as unknown[];
    const n = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d+$/.test(raw.trim()) ? Number(raw) : NaN;
    if (!Number.isInteger(n) || n < 1 || n > items.length) throw new Error(`There is no ${NOUN[list][0]} number ${String(raw)} (it has ${items.length}). Read the project with project_get for the numbers.`);
    return n - 1;
  }

  /** A note path inside the library (never Private notes), as given. */
  private cleanNote(raw: unknown): string {
    const given = str(raw, 600).trim();
    if (splitRowPath(given)) throw new Error('That is a row in a Systems list, not a note file. Read it with note_read; change it with the Systems tools (system_health_note, system_runbook_mark_run, system_check_now).');
    if (splitBillRow(given)) throw new Error('That is a row in the Bills list, not a note file. Read it with note_read; change it with the Money tools (finance_bill_add, finance_bill_mark_paid).');
    if (isPrivatePath(given)) throw new Error(PRIVATE);
    let rel = this.host.notes.clean(given);
    if (!rel) throw new Error('Give a note’s path inside the library, such as "Meetings/Site walk.md".');
    if (!/\.[a-z0-9]{1,8}$/i.test(rel)) rel += '.md';
    if (isPrivatePath(rel)) throw new Error(PRIVATE);
    return rel;
  }

  /** A note that is there: by its path, else its title. */
  private existingNote(raw: unknown): string {
    const rel = this.cleanNote(raw);
    if (this.host.index.get(rel)) return rel;
    const found = this.host.index.resolve(str(raw, 600).trim().replace(/\.md$/i, ''));
    if (found && !isPrivatePath(found)) return found;
    // There, but not this agent's to have: said so plainly (its level), never its words.
    const gate = callAgent.getStore()?.gate;
    if (gate) {
      const hidden = this.base.index.get(rel) ? rel : this.base.index.resolve(str(raw, 600).trim().replace(/\.md$/i, ''));
      if (hidden && !isPrivatePath(hidden)) gate.check(hidden);
    }
    throw new Error(`There is no note ${quote(str(raw, 200))}. Find its path with vault_search or notes_list.`);
  }

  /** A note an agent may change: not a project's file (those go through the project tools). */
  private writableNote(rel: string): void {
    if (!/\.md$/i.test(rel)) throw new Error('Agents change notes (.md) only.');
    const meta = this.host.index.get(rel);
    if (isProjectProps(meta?.props) || isProjectText(this.host.index.content(rel) ?? '')) throw new Error('That is a project’s file: use the project tools (project_set_field, project_add_next_step, project_log_update…), so the change lands in the project’s history.');
  }

  private by(rec: Caller): string {
    return `${rec.name} (agent)`;
  }

  /** A project changed through the page's own edit, as one step. */
  private async editProject(rec: Caller, card: ProjectCard, edits: ProjectEdit[], words?: string): Promise<{ text: string; done: Done }> {
    const r = await this.host.editProject(card.path, edits, this.by(rec), words);
    const name = this.host.projectView(r.file).project.name;
    return { text: `${r.words.replace(/\.$/, '')} in ${name}.`, done: { words: r.words, project: { path: r.file, name }, undo: { kind: 'project', file: r.file, before: r.before, after: r.after } } };
  }

  /**
   * Next steps through the one write check (p12-task-writes, one task one home): each step against the project's
   * open steps and its connected notes' open tasks — exact, then the on-device meaning model — with a match updating
   * that task instead of adding another. On this host, so the agent's gate applies to what it reads and writes; the
   * project-edit path checks again for its own doors, and the planned lines land unchanged there.
   */
  private async planAdds(card: ProjectCard, items: { what: string; who?: string; when?: string; more?: string }[]): Promise<{ edits: ProjectEdit[]; said: string | null; wrote: { rel: string; before: string; after: string }[] }> {
    const { planned, updates } = await planNextAdds(this.host.index, card.path, items, { embed: this.host.embed });
    const wrote = await writeNoteUpdates(this.host.index, planned, (rel, text) => this.host.writeNote(rel, text));
    return { edits: plannedEdits(planned), said: plannedWords(planned, updates), wrote };
  }


  /** project_save_file and note_attach_file: a file sent whole, copied from this PC, or in parts; saved where it belongs. */
  private async saveFile(rec: Caller, tool: string, a: Record<string, unknown>): Promise<{ text: string; done?: Done }> {
    const files = this.host.files;
    if (!files) throw new Error('Saving files needs the Ironleaf app (it isn’t available here).');
    const step = str(a.step, 20).trim().toLowerCase();
    const forNote = tool === 'note_attach_file';
    if (step && !['begin', 'append', 'finish', 'status', 'cancel'].includes(step)) throw new Error('step is begin, append, finish, status or cancel (or leave it out to send the whole file in one call).');
    if (step && step !== 'begin') {
      const m = this.uploads.get(a.upload_id, rec.id);
      if (step === 'status') return { text: json({ upload_id: m.id, name: m.name, received: m.received, size: m.size, next: m.next, parts: Math.ceil(m.size / CHUNK_BYTES), done: m.received === m.size, then: m.received === m.size ? 'finish with sha256' : `append part ${m.next}` }) };
      if (step === 'cancel') {
        await this.uploads.drop(m.id);
        return { text: `Cancelled the upload of ${m.name}. Nothing was saved.` };
      }
      if (step === 'append') {
        const r = await this.uploads.append(m, a.index, a.base64);
        return { text: json({ upload_id: m.id, received: r.received, size: m.size, next: r.next, ...(r.already ? { note: 'That part was already here.' } : {}), then: r.received === m.size ? 'finish with sha256' : `append part ${r.next}` }) };
      }
      // finish
      const whole = await this.uploads.finish(m, a.sha256);
      const out = await this.place(rec, files, whole, { project: m.project, note: m.note, name: m.name, folder: m.folder, replace: m.replace, what: m.what, by: m.by, move: true, tool: m.tool, newVersion: m.newVersion, sourceUrl: m.sourceUrl, parts: true });
      await this.uploads.drop(m.id);
      return out;
    }
    // Where it goes (checked before anything is sent).
    let project: ProjectCard | undefined;
    let note: string | undefined;
    if (forNote) {
      note = this.existingNote(a.note);
    } else {
      if (!str(a.project, 300).trim()) throw new Error('Give the project it is for (projects_list has them).');
      project = this.findProject(a.project);
    }
    const name = safeFileName(a.name ?? (typeof a.from === 'string' ? path.basename(a.from) : typeof a.reference === 'string' ? a.reference.replace(/\\/g, '/').split('/').pop() : ''));
    const folder = forNote ? '' : safeSubfolder(a.folder);
    const what = str(a.what, 200).replace(/\s+/g, ' ').trim() || undefined;
    const replace = a.replace === true;
    const by = str(a.by, 80).trim() || undefined;
    const newVersion = a.new_version === true;
    const sourceUrl = /^https?:\/\//i.test(str(a.source_url, 1000).trim()) ? str(a.source_url, 1000).trim() : undefined;
    // A file on the person's PC linked where it is: nothing copied, nothing sent (src/main/vault-files.ts reference).
    if (typeof a.reference === 'string' && a.reference.trim()) {
      if (!files.reference) throw new Error('Linking a file where it is needs the Ironleaf app.');
      const record = note ?? project?.path;
      if (!record) throw new Error('Give the project (or note) it is for.');
      const real = await this.referenceSource(a.reference.trim());
      const who = rec.name;
      const r = await files.reference(record, real, { by: who, ...(what ? { what } : {}) });
      const where = project ? project.name : `“${titleOf(note ?? '')}”`;
      return {
        text: `Linked ${r.name} to ${where} where it is on the person’s PC (${real}); nothing was copied. It shows in ${where}’s Files with “On this PC”. Tell the person in one line.`,
        done: { words: `Linked ${quote(r.name, 90)} to ${where} (on this PC).`, ...(project ? { project: { path: project.path, name: project.name } } : {}), ...(note ? { note } : {}) },
      };
    }
    if (step === 'begin') {
      const size = typeof a.size === 'number' ? a.size : typeof a.size === 'string' && /^\d+$/.test(a.size.trim()) ? Number(a.size) : NaN;
      const sha256 = str(a.sha256, 80).trim().toLowerCase() || undefined;
      const { meta } = await this.uploads.begin({ agentId: rec.id, agentName: rec.name, tool: forNote ? 'note_attach_file' : 'project_save_file', ...(project ? { project: project.path } : {}), ...(note ? { note } : {}), name, ...(what ? { what } : {}), ...(folder ? { folder } : {}), replace, ...(by ? { by } : {}), ...(newVersion ? { newVersion } : {}), ...(sourceUrl ? { sourceUrl } : {}), size, ...(sha256 ? { sha256 } : {}) });
      const parts = Math.ceil(size / CHUNK_BYTES);
      return {
        text: json({
          upload_id: meta.id,
          parts,
          part_bytes: CHUNK_BYTES,
          next: 0,
          then: `append parts 0 to ${parts - 1} (index, base64 of ${CHUNK_BYTES.toLocaleString('en-AU')} bytes each, the last one shorter), then finish with sha256. A broken upload carries on: step status says which part is next. Unfinished uploads are tidied away after two hours.`,
        }),
      };
    }
    // The whole file in this call: words, base64, or a copy of a file on this PC.
    const temp = path.join(this.host.dataDir, 'agent-uploads', `one_${randomBytes(9).toString('base64url')}.part`);
    await fsp.mkdir(path.dirname(temp), { recursive: true });
    let source = temp;
    let move = true;
    try {
      if (typeof a.content === 'string') {
        if (a.content.length > ONE_CALL_TEXT) throw new Error(`That is more than ${ONE_CALL_TEXT.toLocaleString('en-AU')} characters: send it as base64 in parts (step "begin").`);
        await fsp.writeFile(temp, a.content, 'utf8');
      } else if (typeof a.base64 === 'string') {
        const bytes = decodeBase64(a.base64, CHUNK_CHARS);
        if (!bytes.length) throw new Error('That file is empty.');
        if (typeof a.sha256 === 'string' && a.sha256.trim() && createHash('sha256').update(bytes).digest('hex') !== a.sha256.trim().toLowerCase()) throw new Error('The file doesn’t match its SHA-256, so it wasn’t saved (it changed on the way). Send it again.');
        await fsp.writeFile(temp, bytes);
      } else if (typeof a.from === 'string' && a.from.trim()) {
        source = await this.localSource(a.from.trim());
        move = false;
      } else throw new Error('Send the file: content (plain text), base64 (up to 600 KB of base64), from (a path on this PC), or in parts with step "begin".');
      const st = await fsp.stat(source);
      if (st.size > MAX_FILE_BYTES) throw new Error(`That file is larger than ${MAX_FILE_BYTES / 1048576} MB.`);
      return await this.place(rec, files, source, { ...(project ? { project: project.path } : {}), ...(note ? { note } : {}), name, folder, replace, what, by, move, tool: forNote ? 'note_attach_file' : 'project_save_file', newVersion, sourceUrl });
    } finally {
      await fsp.rm(temp, { force: true }).catch(() => {});
    }
  }

  /** A file on this PC an agent asks to copy in, never from Ironleaf's own data (keys are kept there) or Private notes. */
  private async localSource(from: string): Promise<string> {
    if (!path.isAbsolute(from)) throw new Error('from is a full path on this PC, such as C:\\Users\\…\\Report.pdf.');
    const real = await fsp.realpath(from).catch(() => null);
    if (!real) throw new Error(`There is no file at ${from}.`);
    const within = (dir: string) => {
      const r = path.relative(path.resolve(dir), real);
      return r === '' || (!r.startsWith('..') && !path.isAbsolute(r));
    };
    const never = [this.host.dataDir, ...(this.host.kind === 'embedded' ? [path.dirname(this.host.dataDir)] : [])];
    if (never.some(within)) throw new Error('Files from Ironleaf’s own settings folder are never copied (keys are kept there).');
    const lib = this.host.library();
    if (lib && within(lib) && isPrivatePath(path.relative(lib, real).split(path.sep).join('/'))) throw new Error(PRIVATE);
    const st = await fsp.stat(real);
    if (!st.isFile()) throw new Error(`${from} isn’t a file.`);
    return real;
  }

  /** A file on the person's PC an agent links where it is (an agent anywhere: nothing is copied or sent back to it), never
   *  from Ironleaf's own data or Private notes, never one already in the vault. */
  private async referenceSource(given: string): Promise<string> {
    if (!path.isAbsolute(given)) throw new Error('reference is the file’s whole path on the person’s PC, such as C:\\Users\\…\\Survey.xlsx.');
    const real = await fsp.realpath(given).catch(() => null);
    if (!real) throw new Error(`There is no file at ${given} on the person’s PC.`);
    const within = (dir: string) => {
      const r = path.relative(path.resolve(dir), real);
      return r === '' || (!r.startsWith('..') && !path.isAbsolute(r));
    };
    const never = [this.host.dataDir, ...(this.host.kind === 'embedded' ? [path.dirname(this.host.dataDir)] : [])];
    if (never.some(within)) throw new Error('Files from Ironleaf’s own settings folder are never linked (keys are kept there).');
    const lib = this.host.library();
    if (lib && within(lib)) throw new Error('That file is in the vault already: link to it from the note instead.');
    const st = await fsp.stat(real);
    if (!st.isFile()) throw new Error(`${given} isn’t a file.`);
    return real;
  }

  /** A finished file saved where it belongs, the answer the agent gets, and its line (a card) in What agents did. */
  private async place(rec: Caller, files: AgentFilesHost, source: string, o: { project?: string; note?: string; name: string; folder?: string; replace: boolean; what?: string; by?: string; move: boolean; tool: string; newVersion?: boolean; sourceUrl?: string; parts?: boolean }): Promise<{ text: string; done: Done }> {
    const card = o.project ? this.host.projects().find((c) => c.path === o.project) ?? this.findProject(o.project) : undefined;
    if (o.note && isPrivatePath(o.note)) throw new Error(PRIVATE);
    const full = rec.level === 'full';
    const noteBefore = o.note ? (this.host.index.content(o.note) ?? (await this.host.notes.read(o.note))) : undefined;
    const who = rec.name;
    const how: 'agent' | 'url' | 'upload' = o.sourceUrl ? 'url' : o.parts ? 'upload' : 'agent';
    const d: Delivered = await deliver(files, source, { ...(card ? { project: card.path } : {}), ...(o.note ? { note: o.note } : {}), name: o.name, folder: o.folder, replace: o.replace && full, move: o.move, ...(o.newVersion ? { newVersion: { by: who, how, ...(o.sourceUrl ? { from: o.sourceUrl } : {}) } } : {}) });
    // Its record beside it in Ironleaf: who sent it, how, what it is, its note (src/main/vault-files.ts).
    if (d.place === 'library' && !d.version) await files.recorded?.(d.path, { by: who, how, ...(o.sourceUrl ? { from: o.sourceUrl } : {}), ...(o.what ? { what: o.what } : {}), ...(o.note ? { record: o.note } : card ? { record: card.path } : {}) }).catch(() => undefined);
    let noteAfter: string | undefined;
    if (o.note && noteBefore !== undefined && !d.version) {
      const link = /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i.test(d.name) ? `![[${d.path}]]` : `[[${d.path}|${d.name}]]`;
      noteAfter = `${noteBefore.replace(/\s*$/, '')}${noteBefore.trim() ? '\n\n' : ''}${link}${o.what ? ` — ${o.what}` : ''}\n`;
      await this.host.writeNote(o.note, noteAfter);
    }
    const where = card ? card.name : `“${titleOf(o.note ?? '')}”`;
    const renamed = d.name !== o.name;
    const lines = [
      `Saved ${d.name} (${bytesWords(d.size)}) ${o.note ? `beside the note ${where} and linked it there` : d.place === 'folder' ? `into ${where}’s folder${d.path.includes('/') ? ` (${d.path})` : ''}` : `into ${where}’s Files in Ironleaf${d.path ? ` (${d.path})` : ''}`}.`,
      ...(d.version ? [`It is version ${d.version} of ${d.name}: the one before is kept, and links reach this one.`] : []),
      ...(renamed ? [`A file called ${o.name} was there already, so this one is ${d.name}.${o.newVersion && d.place === 'folder' ? ' (A project’s folder on the PC keeps each file as it is, so it has a new name rather than a new version.)' : ''}`] : []),
      ...(o.replace && !full ? ['Replacing needs Full control, so nothing was overwritten.'] : []),
      ...(d.replaced ? [`It replaced the ${d.name} that was there.`] : []),
      ...(d.remoteName ? [`${where}’s folder is on ${d.remoteName}, which Ironleaf reads but never changes, so the file is kept in Ironleaf with the project.`] : []),
      `Tell the person in one line: it’s in ${where} as ${d.name}. The card shows it; don’t paste its contents.`,
    ];
    const file: SavedFile = { name: d.name, size: d.size, place: d.place, path: d.path, abs: d.abs, mtime: d.mtime, ...(o.what ? { what: o.what } : {}), ...(d.remoteName ? { remoteName: d.remoteName } : {}), ...(d.replaced ? { replaced: true } : {}) };
    return {
      text: lines.join(' '),
      done: {
        words: `${d.replaced ? 'Replaced' : 'Saved'} ${quote(d.name, 90)} ${o.note ? `beside the note ${where}` : `to ${where}`}.`,
        file,
        ...(card ? { project: { path: card.path, name: card.name } } : {}),
        ...(o.note ? { note: o.note } : {}),
        ...(d.replaced ? {} : { undo: { kind: 'file-saved', abs: d.abs, size: d.size, mtime: d.mtime, ...(d.place === 'library' ? { library: d.path } : {}), ...(o.note && noteBefore !== undefined && noteAfter !== undefined ? { note: { path: o.note, before: noteBefore, after: noteAfter } } : {}) } as FileSavedUndo }),
      },
    };
  }

  /**
   * note_to_pdf: a note as its finished branded PDF (5 Nov 2026: a vault's notes as a PDF "using our brand
   * kit... global for anyone using the software"). The same branded document Export to PDF prints
   * (src/shared/brand-document.ts — never a second version), printed the same way, kept in the note's Files as a new
   * version through the one filing path (deliver, as note_attach_file files things), and the file with its page count
   * back. The agent's gate holds for reading the note and filing the PDF, so a private note stays private.
   */
  private async noteToPdf(rec: Caller, a: Record<string, unknown>): Promise<{ text: string; done?: Done }> {
    const files = this.host.files;
    const print = this.host.brandPrint;
    if (!files || !print) throw new Error('Making a PDF needs the Ironleaf app (it isn’t available here).');
    const rel = this.pdfNote(a.note);
    if (!/\.md$/i.test(rel)) throw new Error('PDFs are made from notes (.md).');
    const body = this.host.index.content(rel) ?? (await this.host.notes.read(rel));
    const title = this.host.index.get(rel)?.title ?? titleOf(rel);
    const { level, brand, palette } = await this.noteBrand(rel, body);
    // The mic reads as the owner, as on every other door (18 Nov 2026, t301 round 2).
    const me = this.person();
    const html = brandDocument({
      title,
      text: body ?? '',
      path: rel,
      kit: brand,
      level,
      url: (r) => {
        try {
          return pathToFileURL(files.absolute(r)).href;
        } catch {
          return '';
        }
      },
      resolve: (t) => this.host.index.resolveAny(t, rel) ?? t,
      logoPalette: palette,
      ...(me ? { me } : {}),
    });
    const { pdf, pages } = await print(html);
    const name = `${title}.pdf`;
    const temp = path.join(this.host.dataDir, 'agent-uploads', `pdf_${randomBytes(9).toString('base64url')}.part`);
    await fsp.mkdir(path.dirname(temp), { recursive: true });
    await fsp.writeFile(temp, pdf);
    try {
      const noteBefore = this.host.index.content(rel) ?? (await this.host.notes.read(rel));
      const who = rec.name;
      const d = await deliver(files, temp, { note: rel, name, replace: false, move: true, newVersion: { by: who, how: 'agent' } });
      // Its record beside it, and its link in the note once (a new version needs neither: the link reaches it).
      if (!d.version) await files.recorded?.(d.path, { by: who, how: 'agent', what: 'The note as its branded PDF', record: rel }).catch(() => undefined);
      let noteAfter: string | undefined;
      if (!d.version && !noteBefore.includes(d.path)) {
        noteAfter = `${noteBefore.replace(/\s*$/, '')}${noteBefore.trim() ? '\n\n' : ''}[[${d.path}|${d.name}]]\n`;
        await this.host.writeNote(rel, noteAfter);
      }
      const pageWords = `${pages} ${pages === 1 ? 'page' : 'pages'}`;
      const lines = [
        `Made ${d.name} (${pageWords}) from ${quote(title)}: the note’s finished branded document${brand ? ', set in the brand kit' : ''}.`,
        `Kept in the note’s Files as ${d.path}${d.version ? `, version ${d.version} (the one before is kept)` : ', linked in the note'}.`,
        `Whole path on this PC: ${d.abs}. Hand it to the person from there — link it ([[${d.path}|${d.name}]]) — and say its pages in a line.`,
        ...(brand ? [] : ['There is no brand kit yet: it came out plain, and a brand kit would put their logo on it.']),
      ];
      return {
        text: lines.join(' '),
        done: {
          words: `Made ${quote(d.name, 90)} from the note ${quote(title)}.`,
          file: { name: d.name, size: d.size, place: d.place, path: d.path, abs: d.abs, mtime: d.mtime, what: 'The note as its branded PDF' },
          note: rel,
          undo: { kind: 'file-saved', abs: d.abs, size: d.size, mtime: d.mtime, library: d.path, ...(noteAfter !== undefined ? { note: { path: rel, before: noteBefore, after: noteAfter } } : {}) } as FileSavedUndo,
        },
      };
    } finally {
      await fsp.rm(temp, { force: true }).catch(() => {});
    }
  }

  /** A note's level and its own brand kit (its project's, else its area's, else the default) with its logos' measured
   *  colours: the one reading note_to_pdf and design_document print through, as Export to PDF does. */
  private async noteBrand(rel: string, body: string | null): Promise<{ level: Level | null; brand: BrandKit | null; palette: Partial<Record<'primary' | 'onDark', string[]>> }> {
    // The vault's own level for the note (a Health folder's note marks Confidential though its properties name no
    // level): read through the call's gate, after the read above refused what the agent may not have.
    let level: Level | null = null;
    try {
      level = callAgent.getStore()?.gate?.level(rel) ?? null;
    } catch {
      level = null;
    }
    // The note's own kit, through the one function Export to PDF prints through (the renderer's brandHtmlAndKit reads
    // the same kitForNote rule): its project's kit, else its area's, else the default — with its logos' measured
    // colours. A listing the tool cannot read still prints, cleanly.
    let brand: BrandKit | null = null;
    const palette: Partial<Record<'primary' | 'onDark', string[]>> = {};
    try {
      const listing = await this.host.notes.assets?.list();
      if (listing) {
        const props = this.host.index.get(rel)?.props ?? readProps(body ?? '');
        brand = kitForNote(
          { brand: listing.brand, brands: listing.kits, brandDefault: listing.brandDefault, brandAreas: listing.brandAreas, brandProjects: listing.brandProjects },
          { path: rel, props },
          { areas: this.host.areas?.() ?? [], projects: this.host.projects().map((c) => ({ path: c.path, name: c.name })), places: { templatesFolder: this.host.prefs().templatesFolder, assetsFolder: listing.folder } },
        );
        for (const role of ['primary', 'onDark'] as const) {
          const logoRel = brand?.logos?.[role];
          const entry = logoRel ? listing.assets.find((x) => x.path === logoRel) : undefined;
          if (entry?.palette?.length) palette[role] = entry.palette;
        }
      }
    } catch {
      brand = null;
    }
    return { level, brand, palette };
  }

  /**
   * design_document (22 Nov 2026, the Design studio): a note designed by the person's own AI into a finished PDF in its
   * brand kit — a report, one-pager, proposal, handout, poster or slides — laid out, printed, measured and fixed by
   * src/main/design-studio.ts, then kept in the note's Files as note_to_pdf keeps its PDF. The note's words reach the
   * AI as the branded document reads them (secrets, private paths and the transcript left out), through this call's gate.
   */
  private async designDocument(rec: Caller, a: Record<string, unknown>): Promise<{ text: string; done?: Done }> {
    const files = this.host.files;
    const design = this.host.design;
    if (!files || !design) throw new Error('Designing needs the Ironleaf app with an AI chosen in Settings › AI.');
    const rel = this.pdfNote(a.note);
    if (!/\.md$/i.test(rel)) throw new Error('Designs are made from notes (.md).');
    const body = this.host.index.content(rel) ?? (await this.host.notes.read(rel));
    const title = this.host.index.get(rel)?.title ?? titleOf(rel);
    const { level, brand } = await this.noteBrand(rel, body);
    const url = (r: string) => {
      try {
        return pathToFileURL(files.absolute(r)).href;
      } catch {
        return '';
      }
    };
    const me = this.person();
    const content = brandContent({ title, text: body ?? '', path: rel, kit: brand, level, url, resolve: (t) => this.host.index.resolveAny(t, rel) ?? t, ...(me ? { me } : {}) });
    const format: DesignFormat = isDesignFormat(a.format) ? a.format : 'pdf';
    // PowerPoint is a deck's file; Word is every other kind's.
    const kind = designKindInfo(format === 'pptx' ? 'slides' : a.kind);
    if (format === 'docx' && kind.id === 'slides') throw new Error('Slides save as PowerPoint (pptx) or PDF; Word is for a report, one-pager, proposal, handout or poster.');
    const logo = (r?: string) => (r ? url(r) || undefined : undefined);
    const made = await design({ kind: kind.id, brief: str(a.brief, 2000), title, content, kit: brand, logos: { primary: logo(brand?.logos?.primary), onDark: logo(brand?.logos?.onDark) }, brandName: brand?.name?.trim() ?? '' }, format);
    const name = `${title} – ${kind.name}.${made.ext}`;
    const temp = path.join(this.host.dataDir, 'agent-uploads', `design_${randomBytes(9).toString('base64url')}.part`);
    await fsp.mkdir(path.dirname(temp), { recursive: true });
    await fsp.writeFile(temp, made.data);
    try {
      const who = rec.name;
      const d = await deliver(files, temp, { note: rel, name, replace: false, move: true, newVersion: { by: who, how: 'agent' } });
      const what = `The note designed as a ${kind.name.toLowerCase()}`;
      if (!d.version) await files.recorded?.(d.path, { by: who, how: 'agent', what, record: rel }).catch(() => undefined);
      const pageWords = `${made.pages} ${made.pages === 1 ? 'page' : 'pages'}`;
      const lines = [
        `Designed ${d.name} (${format === 'xlsx' ? 'an Excel workbook of its tables and key figures' : pageWords}) from ${quote(title)}: a ${kind.name.toLowerCase()}${brand ? ' in the brand kit' : ''}, printed and checked page by page${format === 'pdf' ? '' : `, saved as ${DESIGN_FORMATS[format].name}`}.`,
        `Kept in the note’s Files as ${d.path}${d.version ? `, version ${d.version} (the one before is kept)` : ''}.`,
        `Whole path on this PC: ${d.abs}. Hand it to the person from there — link it ([[${d.path}|${d.name}]]) — and say its pages in a line. To change it, they can open Design with AI on the note and ask for the change in words.`,
        ...(made.problems.length ? [`Still not right on the pages: ${made.problems.slice(0, 3).join('; ')}. Say so in a line.`] : []),
        ...(brand ? [] : ['There is no brand kit yet: it came out in a plain neutral style, and a brand kit would put their logo and colours on it.']),
      ];
      return { text: lines.join(' '), done: { words: `Designed ${quote(d.name, 90)} from the note ${quote(title)}.`, file: { name: d.name, size: d.size, place: d.place, path: d.path, abs: d.abs, mtime: d.mtime, what }, note: rel, undo: { kind: 'file-saved', abs: d.abs, size: d.size, mtime: d.mtime, library: d.path } as FileSavedUndo } };
    } finally {
      await fsp.rm(temp, { force: true }).catch(() => {});
    }
  }

  /** A note for its PDF: by path, else by title. Two notes of one title are asked about by name, never guessed;
   *  there-but-not-this-agent's is refused saying its level, as reads are. */
  private pdfNote(raw: unknown): string {
    const rel = this.cleanNote(raw);
    if (this.host.index.get(rel)) return rel;
    const key = str(raw, 600).trim().replace(/\.md$/i, '').toLowerCase();
    const matches = this.host.index.allMeta().filter((m) => /\.md$/i.test(m.path) && ((m.title ?? '').toLowerCase() === key || (m.aliases ?? []).some((x) => String(x).toLowerCase() === key)));
    if (matches.length > 1) throw new Error(`More than one note is called ${quote(str(raw, 200).trim())}: ${matches.map((m) => m.path).sort().slice(0, 10).join('; ')}. Say which.`);
    if (matches.length === 1) return matches[0].path;
    const found = this.host.index.resolve(str(raw, 600).trim().replace(/\.md$/i, ''));
    if (found && !isPrivatePath(found)) return found;
    const gate = callAgent.getStore()?.gate;
    if (gate) {
      const hidden = this.base.index.get(rel) ? rel : this.base.index.resolve(str(raw, 600).trim().replace(/\.md$/i, ''));
      if (hidden && !isPrivatePath(hidden)) gate.check(hidden);
    }
    throw new Error(`There is no note ${quote(str(raw, 200))}. Find its path with vault_search or notes_list.`);
  }

  /** files_find: every file Ironleaf keeps that matches, with the record it belongs to, then files in projects' folders. */
  private async filesFind(a: Record<string, unknown>): Promise<string> {
    const query = str(a.query, 200).trim();
    if (!query) throw new Error('Say what to look for: words from the file’s name, what it is, or where it came from.');
    const limit = num(a.limit, 1, 40, 15);
    const words = query.toLowerCase().split(/[\s,]+/).filter((w) => w.length > 1 || /\d/.test(w));
    const gate = callAgent.getStore()?.gate;
    const index = this.host.index;
    const titleOf = (rel: string) => index.get(rel)?.title ?? rel.split('/').pop()!.replace(/\.md$/i, '');
    const all = this.host.fileCatalogue ? await this.host.fileCatalogue() : [];
    const scored: { f: FileFound; score: number; at: number }[] = [];
    for (const f of all) {
      if (isPrivatePath(f.path) || (gate && !gate.sees(f.record ?? f.path))) continue;
      const named = `${f.name} ${f.title}`.toLowerCase();
      const hay = `${named} ${f.summary ?? ''} ${f.what} ${f.source?.from ?? ''} ${f.ref?.path ?? ''} ${f.folder} ${f.record ? titleOf(f.record) : ''}`.toLowerCase();
      if (!words.every((w) => hay.includes(w))) continue;
      scored.push({ f, score: words.filter((w) => named.includes(w)).length, at: Date.parse(f.added ?? '') || f.mtime || 0 });
    }
    scored.sort((x, y) => y.score - x.score || y.at - x.at);
    const day = (ms: number) => (ms ? formatDate('D MMM YYYY', new Date(ms)) : '');
    const lines = scored.slice(0, limit).map(({ f, at }) => {
      const where = f.record ? `with ${quote(titleOf(f.record), 80)} (${f.record}): it shows on that page` : `loose in ${f.folder || 'the top of the vault'}`;
      const from = f.source?.from ? ` from ${f.source.from}` : '';
      const by = f.source?.by ? ` by ${f.source.by}` : '';
      const linked = f.ref ? ` · linked where it is on this PC: ${f.ref.path}${f.ref.missing ? ' (not there any more)' : ''}` : '';
      return `- ${f.name} — ${where} · ${f.kind}, ${bytesWords(f.size)}${f.version > 1 ? `, version ${f.version}` : ''} · added ${day(at)}${by}${from} · path ${f.path}${linked}`;
    });
    // Files in projects' own folders on this PC (or a remote computer), found by name and words.
    const folderHits = (this.host.notes.projectFiles?.search(query, undefined, Math.min(limit, 10)) ?? []).filter((h) => !gate || gate.sees(h.project));
    const more = folderHits.map((h) => `- ${h.name} — in ${quote(h.projectName, 80)}’s folder (${h.project}): ${h.rel}`);
    if (!lines.length && !more.length) return `No file in Ironleaf matches “${query}”: it hasn’t been filed (it may still be where it was on this PC), or it has other words in its name. Try other words, or look on the PC.`;
    return [lines.length ? `Files Ironleaf keeps (${scored.length} match${scored.length === 1 ? '' : 'es'}${scored.length > limit ? `, the first ${limit}` : ''}):\n${lines.join('\n')}` : '', more.length ? `In projects’ folders:\n${more.join('\n')}` : ''].filter(Boolean).join('\n\n');
  }

  /** tasks_list: the tasks across the notes, as the Tasks view filters them. */
  private tasksList(a: Record<string, unknown>): string {
    if (!this.host.tasks) throw new Error('The tasks can’t be read here.');
    const view = this.host.tasks();
    const gate = callAgent.getStore()?.gate;
    const when = (['any', 'overdue', 'today', 'week', 'none'] as const).includes(a.when as TaskWhen) ? (a.when as TaskWhen) : 'any';
    const status = (['open', 'done', 'all'] as const).includes(a.status as TaskStatus) ? (a.status as TaskStatus) : 'open';
    const project = str(a.project, 300).trim() ? this.findProject(a.project).path : undefined;
    const filter: TaskFilter = { status, when, sort: 'due', ...(project ? { project } : {}), ...(str(a.text, 200).trim() ? { text: str(a.text, 200).trim() } : {}) };
    const mine = view.tasks.filter((t) => !isPrivatePath(t.path) && (!gate || gate.sees(t.path)));
    const list = filterTasks(mine, filter, view.today);
    const limit = num(a.limit, 1, 200, 50);
    return json({
      today: view.today,
      count: list.length,
      tasks: list.slice(0, limit).map((t) => ({ what: t.words, done: t.done || undefined, due: t.due, time: t.time, overdue: !t.done && !!t.due && t.due < view.today ? true : undefined, reminder: t.reminder || undefined, note: t.path, project: t.projectName })),
      ...(list.length > limit ? { more: list.length - limit } : {}),
    });
  }

  private async dispatch(rec: Caller, name: string, a: Record<string, unknown>): Promise<{ text: string; done?: Done }> {
    const index = this.host.index;
    const def = toolDef(name);
    if (def && (def.level === 'full' || ['canvas_get', 'project_files_list'].includes(name))) {
      const out = await runFullTool(this.fullKit(rec), name, a);
      if (out) return out;
    }
    switch (name) {
      // ── Read ──
      case 'vault_overview': {
        const overview = await this.reader('notes_overview', {});
        const cards = this.host.projects();
        const projects = cards.length ? cards.slice(0, 60).map((c) => `${c.name} (${[c.status, c.health].filter(Boolean).join(', ') || 'no status'})`).join('; ') : 'none yet';
        return { text: `${overview}\nProjects (${cards.length}): ${projects}${cards.length > 60 ? '; … (projects_list has every one)' : ''}\nTemplates folder: ${this.host.prefs().templatesFolder || 'none'}` };
      }
      case 'vault_search':
        return { text: await this.reader('search_notes', { query: str(a.query, 300), limit: num(a.limit, 1, SEARCH_MAX, SEARCH_LIMIT) }) };
      case 'notes_list':
        return { text: await this.reader('list_notes', { folder: str(a.folder, 300), sort: a.sort === 'name' ? 'name' : 'recent', limit: num(a.limit, 1, LIST_MAX, LIST_LIMIT) }) };
      case 'notes_recent':
        return { text: await this.reader('recent_notes', { days: num(a.days, 1, 365, RECENT_DAYS), limit: num(a.limit, 1, RECENT_MAX, RECENT_LIMIT) }) };
      case 'files_search':
        return { text: await this.reader('search_project_files', { query: str(a.query, 300), ...(str(a.project, 300) ? { project: str(a.project, 300) } : {}), limit: num(a.limit, 1, FILE_SEARCH_MAX, FILE_SEARCH_LIMIT) }) };
      case 'file_read':
        return { text: await this.reader('read_project_file', { project: str(a.project, 300), path: str(a.path, 1000), part: num(a.part, 1, 500, 1) }) };
      case 'assets_search':
        return { text: await this.reader('list_assets', { ...(str(a.query, 200) ? { query: str(a.query, 200) } : {}), ...(str(a.kind, 20) ? { kind: str(a.kind, 20) } : {}), limit: num(a.limit, 1, ASSET_MAX, ASSET_LIMIT) }) };
      case 'brand_kit_get':
        return { text: await this.reader('brand_kit', {}) };
      case 'note_read': {
        // A Systems list row reads as the note it would be (its page in words, never the whole list).
        const rowGiven = str(a.path, 600).trim();
        if (splitRowPath(rowGiven)) {
          const gate = callAgent.getStore()?.gate;
          if (gate && !gate.allowsLevel('personal')) throw new Error(refusal('personal', gate.name));
          const tables = makeRowResolver(this.host.index).tables();
          const texts: Partial<Record<SystemsTableKind, string>> = {};
          for (const [kind, rel] of Object.entries(tables)) (texts as Record<string, string>)[kind] = this.host.index.content(rel) ?? '';
          const rendered = renderRowFromTableTexts(texts, rowGiven);
          if (!rendered) throw new Error(`There is no note ${quote(str(a.path, 200))}. Find its path with vault_search or notes_list.`);
          const { text: rowPiece } = partOf(rendered, num(a.part, 1, 500, 1));
          this.noteReadBy(rec.id, rowGiven);
          return { text: `${rowGiven}\n\n${rowPiece}` };
        }
        // A Bills list row reads as the note it would be (its page in words, never the whole list).
        if (splitBillRow(rowGiven)) {
          const gate = callAgent.getStore()?.gate;
          if (gate && !gate.allowsLevel('personal')) throw new Error(refusal('personal', gate.name));
          const table = makeBillRowResolver(this.host.index).table();
          const rendered = table === null ? null : renderBillRowFromTableText(this.host.index.content(table) ?? '', rowGiven);
          if (!rendered) throw new Error(`There is no note ${quote(str(a.path, 200))}. Find its path with vault_search or notes_list.`);
          const { text: rowPiece } = partOf(rendered, num(a.part, 1, 500, 1));
          this.noteReadBy(rec.id, rowGiven);
          return { text: `${rowGiven}\n\n${rowPiece}` };
        }
        // A file among the notes that isn't a note reads as its words (readNoteFile: the one read path with read_note).
        const file = await readNoteFile({ index: this.host.index, pictureWords: this.host.notes.pictureWords, readNoteDocument: this.host.notes.readNoteDocument }, str(a.path, 600).trim(), num(a.part, 1, 500, 1));
        if (file) return { text: file.text };
        const rel = this.existingNote(a.path);
        const body = index.content(rel) ?? (await this.host.notes.read(rel));
        const { text: piece } = partOf(body || EMPTY_NOTE, num(a.part, 1, 500, 1));
        this.noteReadBy(rec.id, rel);
        return { text: `${rel}\n\n${piece}` };
      }
      case 'projects_list': {
        const all = this.host.projects();
        const done = (s?: string) => /\b(done|closed|complete|completed|cancelled)\b/i.test(s ?? '');
        const shown = a.include_done === true ? all : all.filter((c) => !done(c.status));
        return { text: json({ projects: shown.slice(0, 150).map((c) => ({ name: c.name, status: c.status, health: c.health, progress: c.progress, owner: c.owner, due: c.due, openSteps: c.openNext, next: c.next, risks: c.risks || undefined, topRisk: c.topRisk })), ...(all.length > shown.length ? { doneLeftOut: all.length - shown.length } : {}), ...(shown.length > 150 ? { more: shown.length - 150 } : {}) }) };
      }
      case 'project_get': {
        const card = this.findProject(a.project);
        const v = this.host.projectView(card.path);
        const p = v.project;
        const numbered = <T extends object>(list: T[], max: number, from = 0) => list.slice(from, from + max).map((x, i) => ({ n: from + i + 1, ...x }));
        const decisionsFrom = Math.max(0, p.decisions.length - 10);
        return {
          text: json({
            name: p.name,
            path: v.path,
            status: p.status,
            health: p.health,
            progress: p.progress,
            owner: p.owner,
            started: p.started,
            due: p.due,
            updated: p.updated,
            folder: p.folder,
            // Its folder is on another of the person's PCs (src/main/project-places.ts): its page offers the choices.
            folderOnAnotherPC: v.place?.state === 'elsewhere' ? v.place.recorded : undefined,
            tags: p.tags.length ? p.tags : undefined,
            summary: p.summary.length > 2500 ? `${p.summary.slice(0, 2499)}…` : p.summary,
            next: numbered(p.next, 60),
            dates: numbered(p.dates, 40),
            people: numbered(p.people, 40),
            risks: numbered(p.risks, 30),
            decisions: numbered(p.decisions, 10, decisionsFrom),
            updates: numbered(p.updates, 10),
            documents: numbered(p.documents, 30),
            notes: v.notes.length || undefined,
            activity: v.activity.slice(0, 5).map((x) => x.title),
            ...(p.decisions.length > 10 ? { olderDecisions: decisionsFrom } : {}),
            ...(p.updates.length > 10 ? { olderUpdates: p.updates.length - 10, readAll: `note_read ${v.path}` } : {}),
          }),
        };
      }
      case 'today_get': {
        const t = this.host.today();
        const due = (x: TodayData['due']['today'][number]) => ({ project: x.projectName, what: x.what, who: x.who, when: x.when, kind: x.kind === 'step' ? 'next step' : x.kind === 'date' ? 'key date' : 'project due', ...(x.kind === 'step' && x.index !== undefined ? { n: x.index + 1 } : {}) });
        return {
          text: json({
            date: t.date,
            me: t.me,
            projects: t.projects,
            overdue: t.due.overdue.slice(0, 25).map(due),
            dueToday: t.due.today.slice(0, 25).map(due),
            dueSoon: t.due.soon.slice(0, 25).map(due),
            // The person's own deadlines after this week (up to 30 days), and key dates that went by without being marked done:
            // ask the person whether they happened; never call them overdue work (29 Oct 2026).
            comingUp: (t.due.later ?? []).slice(0, 15).map(due),
            datesToConfirm: (t.due.passed ?? []).slice(0, 15).map(due),
            atRisk: t.atRisk.slice(0, 20).map((x) => ({ project: x.projectName, health: x.health, progress: x.progress, due: x.due, risks: x.risks.slice(0, 3).map((r) => `${r.level}: ${r.what}`), next: x.next })),
            waitingOn: t.waiting.slice(0, 25).map((x) => ({ project: x.projectName, who: x.who, what: x.what, when: x.when })),
            changedSinceYesterday: t.changed.slice(0, 15).map((g) => ({ project: g.projectName, lines: g.lines.slice(0, 3).map((l) => l.what) })),
            meetings: t.meetings.map((m) => ({ title: m.title, path: m.path, time: m.time, with: m.attendees.length ? m.attendees : undefined })),
            allClear: t.clear || undefined,
          }),
        };
      }
      case 'timeline_get': {
        const today = todayDay();
        const back = num(a.days_back, 0, 730, 14);
        const ahead = num(a.days_ahead, 0, 730, 60);
        const only = str(a.project, 300).trim() ? this.findProject(a.project).path : null;
        const rows = this.host.allProjects().map((x) => projectTimeline(x.path, x.project, today));
        const problems = findProblems(rows, today);
        const shown = rows.filter((r) => !only || r.path === only);
        const dates = shown
          .flatMap((r) => r.marks.filter((m) => m.day >= today - back && m.day <= today + ahead).map((m) => ({ day: m.day, row: r, m })))
          .sort((x, y) => x.day - y.day);
        const look = problems.list.filter((x) => !only || x.mark.path === only);
        const nameOf = new Map(rows.map((r) => [r.path, r.name]));
        return {
          text: json({
            today: isoDay(today),
            from: isoDay(today - back),
            to: isoDay(today + ahead),
            dates: dates.slice(0, 160).map(({ row, m }) => ({ day: isoDay(m.day), project: row.name, kind: KIND_WORDS[m.kind], what: m.words, who: m.who, done: m.done || undefined, status: m.status })),
            needsALook: look.slice(0, 40).map((x) => ({ day: isoDay(x.mark.day), project: nameOf.get(x.mark.path), what: x.mark.words, problem: x.problem.words })),
            ...(dates.length > 160 ? { more: `${dates.length - 160} more dates: ask for a narrower window or one project` } : {}),
          }),
        };
      }
      case 'meetings_list': {
        const days = num(a.days, 1, 365, 30);
        const since = Date.now() - days * DAY;
        const templates = this.host.prefs().templatesFolder;
        const found = index
          .allMeta()
          .filter((m) => !isPrivatePath(m.path) && !(templates && inFolder(m.path, templates)) && !isProjectProps(m.props) && isMeetingNote(m.path, m.props))
          .map((m) => ({ m, day: meetingDate(m.path, m.props, new Date(m.mtime)) }))
          .filter((x) => x.day.getTime() >= since - DAY)
          .sort((x, y) => y.day.getTime() - x.day.getTime());
        const limit = num(a.limit, 1, 50, 15);
        return {
          text: json({
            meetings: found.slice(0, limit).map(({ m, day }) => {
              const body = index.content(m.path) ?? '';
              const actions = findActions(body, { date: day, people: notePeople(body, m.props) });
              const project = typeof m.props?.project === 'string' ? m.props.project.replace(/^\[\[|\]\]$/g, '').split('|').pop() : undefined;
              return { path: m.path, title: m.label || m.title, day: localDay(day.getTime()), project, actionsOpen: actions.filter((x) => !x.filedTo).length, actionsAdded: actions.filter((x) => x.filedTo).length || undefined };
            }),
            ...(found.length > limit ? { more: found.length - limit } : {}),
          }),
        };
      }
      // The connected vault (src/shared/records.ts): private notes are never in it.
      case 'connected_to':
      case 'person_open_items':
      case 'meeting_items':
        return { text: answerRecordTool(index.records({ templatesFolder: this.host.prefs().templatesFolder || 'Templates' }), name, a) ?? '' };
      case 'meeting_actions': {
        const rel = this.existingNote(a.note);
        const meta = index.get(rel)!;
        const body = index.content(rel) ?? '';
        const day = meetingDate(rel, meta.props, new Date(meta.mtime));
        const actions = findActions(body, { date: day, people: notePeople(body, meta.props) });
        return { text: json({ note: rel, day: localDay(day.getTime()), actions: actions.slice(0, 60).map((x) => ({ what: x.what, who: x.who, when: x.due ?? x.whenWords, alreadyIn: x.filedTo })) }) };
      }
      case 'reviews_list': {
        const reviews = index
          .allMeta()
          .filter((m) => m.path.startsWith('Reviews/') && (m.props?.type === 'review' || /review/i.test(m.path)))
          .sort((x, y) => y.mtime - x.mtime);
        const last = await this.host.lastReview().catch(() => null);
        return { text: json({ lastDone: last ? localDay(last) : null, reviews: reviews.slice(0, 12).map((m) => ({ path: m.path, title: m.title, changed: localDay(m.mtime) })), ...(reviews.length > 12 ? { more: reviews.length - 12 } : {}) }) };
      }
      case 'templates_list': {
        const group = a.group === 'notes' || a.group === 'projects' || a.group === 'reports' ? a.group : null;
        const list = this.host.templates().filter((t) => !group || t.group === group);
        return { text: list.length ? json({ templates: list.slice(0, 80).map((t) => ({ name: t.name, group: t.group, path: t.path, for: t.usedFor, about: t.description })) }) : 'No templates in the library yet.' };
      }
      case 'tidy_list': {
        if (!this.host.tidy) return { text: 'The weekly tidy is not set up here.' };
        const lines = await this.host.tidy.list();
        return { text: lines.length ? json({ tidy: lines.map((l) => ({ id: l.id, title: l.title, apply: l.detail })) }) : 'Nothing waits in the weekly tidy.' };
      }
      // ── Edit ──
      case 'project_create': {
        const title = str(a.name, 120).replace(/\s+/g, ' ').trim();
        if (!title) throw new Error('Give the project a name.');
        const known = this.host.projects().find((c) => c.name.toLowerCase() === title.toLowerCase());
        if (known) throw new Error(`There’s already a project called ${title} (${known.path}). Open it and bring it up to date instead of making another.`);
        // A near name is not a new project ("Harbour" is "Harbour Lane" until said otherwise): refuse, naming it.
        const nearName = nearProjectRefusal(
          title,
          this.host.projects().map((c) => c.name),
        );
        if (nearName) throw new Error(nearName);
        const template = str(a.template, 400).trim();
        if (template && isPrivatePath(template)) throw new Error(PRIVATE);
        const file = await this.host.createProject(title, template || undefined);
        const summary = str(a.summary, 4000).trim();
        if (summary) await this.host.editProject(file, [{ kind: 'set', field: 'summary', value: summary }], this.by(rec));
        const made = index.content(file) ?? '';
        return { text: `Started the project ${title} (${file}).`, done: { words: `Started the project ${quote(title)}.`, project: { path: file, name: title }, undo: { kind: 'note-made', path: file, text: made } } };
      }
      case 'project_set_field': {
        const card = this.findProject(a.project);
        const fields = ['status', 'health', 'progress', 'owner', 'started', 'due', 'summary'] as const;
        const field = fields.find((f) => f === a.field);
        if (!field) throw new Error(`field is one of ${fields.join(', ')}.`);
        const value = a.value === null || a.value === undefined ? null : typeof a.value === 'number' ? a.value : str(a.value, field === 'summary' ? 20000 : 300);
        if (field === 'status' && value && !/^(idea|planning|active|on hold|done)$/i.test(String(value))) throw new Error('status is idea, planning, active, on hold or done.');
        if (field === 'health' && value && !/^(on track|at risk|off track)$/i.test(String(value))) throw new Error('health is on track, at risk or off track.');
        // Marking done with open tasks is never silent (p12-close-and-noise A): the open tasks come back in plain
        // words for the person to answer, and the project stays as it is.
        if (field === 'status' && typeof value === 'string' && value.trim().toLowerCase() === 'done') {
          const open = openProjectTasks(this.host.projectView(card.path).project);
          if (open.length) return { text: `${closeBlockedWords(card.name, open)} Nothing was changed.` };
        }
        return this.editProject(rec, card, [{ kind: 'set', field, value: typeof value === 'string' && (field === 'status' || field === 'health') ? value.toLowerCase() : value }]);
      }
      case 'project_add_next_step': {
        const card = this.findProject(a.project);
        const raw = Array.isArray(a.steps) && a.steps.length ? a.steps : [{ what: a.what, who: a.who, when: a.when }];
        const items = raw.slice(0, 100).map((x) => (x && typeof x === 'object' ? (x as Record<string, unknown>) : {})).filter((x) => str(x.what, 400).trim());
        if (!items.length) throw new Error('Give the step’s words in what.');
        // A step is one short action someone does (29 Oct 2026): a paragraph, or a day written as the person, is said
        // back to be rewritten.
        for (const x of items) {
          const what = str(x.what, 400).trim();
          const who = str(x.who, 80).trim();
          if (what.length > STEP_MAX) throw new Error(`A next step is one short action someone does, under 25 words (this one is ${what.split(/\s+/).length}): “${quote(what, 80)}”. Keep the action and put the background in the project’s notes or Updates.`);
          if (who && readDay(who.replace(/\s*\(.*$/, ''), new Date())) throw new Error(`who is the person who does it, not a day (“${who}”): give the day in when.`);
        }
        // One task, one home (p12-task-writes): the write check plans each step (a match updates that task, on the
        // project or in its notes, and says "already there: <line>; updated"); all fresh lands as it always did.
        const { edits, said, wrote } = await this.planAdds(
          card,
          items.map((x) => ({ what: str(x.what, 400).trim(), ...(str(x.who, 80).trim() ? { who: str(x.who, 80).trim() } : {}), ...(str(x.when, 60).trim() ? { when: str(x.when, 60).trim() } : {}) })),
        );
        const fresh = items.length === 1 ? `Added a next step: ${quote(str(items[0].what, 400).trim())}.` : `Added ${items.length} next steps.`;
        if (!edits.length) {
          const words = said ?? fresh;
          const only = wrote.length === 1 ? wrote[0] : null;
          return { text: `${words.replace(/\.$/, '')} in ${card.name}.`, done: { words, project: { path: card.path, name: card.name }, ...(only ? { note: only.rel, undo: { kind: 'note-edited', path: only.rel, before: only.before, after: only.after } } : {}) } };
        }
        return this.editProject(rec, card, edits, said ?? fresh);
      }
      case 'project_tick_next_step': {
        const card = this.findProject(a.project);
        const p = this.host.projectView(card.path).project;
        let i: number;
        if (typeof a.step === 'string' && !/^\d+$/.test(a.step.trim())) {
          const want = a.step.trim().toLowerCase();
          const hits = p.next.map((n, k) => ({ n, k })).filter((x) => x.n.what.toLowerCase().includes(want));
          if (hits.length !== 1) throw new Error(hits.length ? `Several next steps match “${a.step}”: give its number from project_get.` : `No next step of ${card.name} says “${a.step}”.`);
          i = hits[0].k;
        } else i = this.lineIndex(p, 'next', a.step);
        return this.editProject(rec, card, [{ kind: 'change', list: 'next', index: i, item: { done: a.done !== false } }]);
      }
      case 'project_log_update': {
        const card = this.findProject(a.project);
        const what = str(a.what, 600).trim();
        if (!what) throw new Error('Say what happened in what.');
        if (what.length > UPDATE_MAX) throw new Error(`An update is one or two plain sentences, under 50 words (this one is ${what.split(/\s+/).length}). Say what happened and what it changes; put the rest in a note and name it in from.`);
        // An update said again is not logged again.
        const logged = this.host.projectView(card.path).project.updates;
        const dup = logged.findIndex((u) => lineIdentity('updates', u as unknown as Record<string, unknown>) === lineIdentity('updates', { what }));
        if (dup >= 0) return { text: `Nothing added: ${quote(what)} is already logged (update ${dup + 1}).` };
        return this.editProject(rec, card, [{ kind: 'add', list: 'updates', item: { what, ...(str(a.from, 300).trim() ? { from: str(a.from, 300).trim() } : {}), ...(str(a.date, 40).trim() ? { date: str(a.date, 40).trim() } : {}) } }], `Logged an update: ${quote(what)}.`);
      }
      case 'project_add_item': {
        const card = this.findProject(a.project);
        const list = this.listOf(a.list, ['dates', 'risks', 'decisions', 'people', 'documents']);
        const raw = Array.isArray(a.items) && a.items.length ? a.items : [a.item];
        const items = raw.slice(0, 100).filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x));
        if (!items.length) throw new Error('Give the line in item (or several in items).');
        // Lines already there stay single: skipped and named, never doubled.
        const have = (this.host.projectView(card.path).project[list] as unknown as Record<string, unknown>[]).map((x, i) => ({ id: lineIdentity(list, x), n: i + 1 })).filter((x) => x.id);
        const skipped: string[] = [];
        const fresh: typeof items = [];
        const seen = new Set<string>();
        for (const item of items) {
          const id = lineIdentity(list, item);
          const hit = id ? have.find((o) => o.id === id) : undefined;
          if (hit) skipped.push(`${quote(lineWords(list, item))} (already ${NOUN[list][0]} ${hit.n})`);
          else if (id && seen.has(id)) skipped.push(`${quote(lineWords(list, item))} (said twice)`);
          else {
            if (id) seen.add(id);
            fresh.push(item);
          }
        }
        if (!fresh.length) return { text: `Nothing added: ${skipped.join('; ')}.` };
        const said = skipped.length ? ` Already there: ${skipped.join('; ')}.` : '';
        const n = fresh.length;
        return this.editProject(rec, card, fresh.map((item) => ({ kind: 'add', list, item })), (n === 1 ? `Added a ${NOUN[list][0]}: ${quote(lineWords(list, fresh[0]))}.` : `Added ${n} ${NOUN[list][1]}.`) + said);
      }
      case 'project_change_item': {
        const card = this.findProject(a.project);
        const list = this.listOf(a.list);
        const p = this.host.projectView(card.path).project;
        const i = this.lineIndex(p, list, a.number);
        const item = a.item && typeof a.item === 'object' && !Array.isArray(a.item) ? (a.item as Record<string, unknown>) : null;
        if (!item) throw new Error('Give the parts to change in item.');
        return this.editProject(rec, card, [{ kind: 'change', list, index: i, item }]);
      }
      case 'project_remove_item': {
        const card = this.findProject(a.project);
        const list = this.listOf(a.list);
        const p = this.host.projectView(card.path).project;
        const i = this.lineIndex(p, list, a.number);
        const line = lineWords(list, (p[list] as unknown as Record<string, unknown>[])[i]);
        return this.editProject(rec, card, [{ kind: 'remove', list, index: i }], `Removed a ${NOUN[list][0]}: ${quote(line)}.`);
      }
      case 'note_create': {
        const rel = this.cleanNote(a.path);
        if (!/\.md$/i.test(rel)) throw new Error('A note’s path ends in .md.');
        if (await this.host.notes.exists(rel)) throw new Error(`${rel} is already there. Read it and use note_append, or choose another name.`);
        // The same note by another path, unread: the side chat's guard, shared (a second "Credit Card" is refused for
        // every agent, whatever calls it).
        const sameTitle = this.sameTitleRefusal(rec.id, rel);
        if (sameTitle) throw new Error(sameTitle);
        const content = str(a.content, 200_000);
        if (isProjectText(content)) throw new Error('That is a project file: start projects with project_create.');
        await this.host.writeNote(rel, content);
        return { text: `Made ${rel}.`, done: { words: `Made the note ${quote(titleOf(rel))}.`, note: rel, undo: { kind: 'note-made', path: rel, text: content } } };
      }
      case 'note_append': {
        const rel = this.existingNote(a.path);
        this.writableNote(rel);
        const add = str(a.text, 100_000).replace(/\r\n/g, '\n').trim();
        if (!add) throw new Error('Give the text to add.');
        const before = index.content(rel) ?? (await this.host.notes.read(rel));
        const heading = str(a.heading, 120).replace(/^#+\s*/, '').trim();
        if (!heading && alreadyAppended(before, add)) return { text: `That text is already the last thing in ${rel}, so nothing was added.` };
        const after = heading ? appendUnder(before, add.split('\n'), heading.replace(/[.*+?^${}()|[\]\\]/g, '')) : `${before.replace(/\s*$/, '')}${before.trim() ? '\n\n' : ''}${add}\n`;
        await this.host.writeNote(rel, after);
        return { text: `Added to ${rel}.`, done: { words: `Added to the note ${quote(titleOf(rel))}.`, note: rel, undo: { kind: 'note-edited', path: rel, before, after } } };
      }
      // note_add_task is the local MCP server's own (other AI apps; src/shared/mcp-local.ts): agents reach tasks
      // through projects and capture, so it is not in their tools: only asLocalMcp names it here.
      case 'note_add_task': {
        const rel = this.existingNote(a.path);
        this.writableNote(rel);
        const what = str(a.text, 500).replace(/\s+/g, ' ').trim();
        if (!what) throw new Error('Give the task’s words.');
        const heading = str(a.heading, 120).replace(/^#+\s*/, '').trim();
        // One task, one home (p12-task-writes): a person's page or the hub routes onto the one project that fits
        // (the page keeps a plain pointer); no project fitting means the Inbox; any other note stays as asked.
        const route = routeNoteTask(
          {
            index,
            dailyPath: this.host.dailyPath(),
            projects: () => this.host.projects().map((c) => {
              const pv = this.host.projectView(c.path).project;
              return { path: c.path, name: c.name, owner: pv.owner, people: pv.people.map((x) => x.name) };
            }),
          },
          rel,
          what,
        );
        if (route.kind === 'project') {
          const card = this.findProject(route.project.path);
          const { edits, said, wrote } = await this.planAdds(card, [{ what }]);
          const pointer = taskPointerLine(what, route.project.name);
          const pageBefore = index.content(route.personNote) ?? (await this.host.notes.read(route.personNote));
          const pointed = !pageBefore.includes(pointer);
          if (pointed) await this.host.writeNote(route.personNote, `${pageBefore.replace(/\s*$/, '')}${pageBefore.trim() ? '\n\n' : ''}${pointer}\n`);
          const words = `${said ?? `Added to ${route.project.name}’s next steps.`}${pointed ? ` ${titleOf(route.personNote)}’s page now points to it.` : ''}`;
          if (!edits.length) {
            const only = wrote.length === 1 ? wrote[0] : null;
            return { text: words, done: { words, project: { path: card.path, name: card.name }, note: route.personNote, ...(only ? { undo: { kind: 'note-edited', path: only.rel, before: only.before, after: only.after } } : {}) } };
          }
          const out = await this.editProject(rec, card, edits, said ?? `Added a next step: ${quote(what)}.`);
          return { text: `${words}`, done: { ...out.done, words } };
        }
        if (route.kind === 'inbox') {
          const before = index.content(INBOX_NOTE) ?? '';
          const line = inboxTaskLine(what);
          const after = appendUnder(before, [line]);
          await this.host.writeNote(INBOX_NOTE, after);
          const words = `No project fits ${quote(titleOf(rel))}, so it went to the Inbox.`;
          return { text: words, done: { words, note: INBOX_NOTE, undo: before ? { kind: 'note-edited', path: INBOX_NOTE, before, after } : { kind: 'note-made', path: INBOX_NOTE, text: after } } };
        }
        const before = index.content(rel) ?? (await this.host.notes.read(rel));
        const now = new Date();
        const due = parseDue(what, now);
        const rest = due ? due.rest : what;
        const line = due ? setTaskDue(`- [ ] ${rest}`, due.iso) : `- [ ] ${what}`;
        if (!heading) {
          // The same task already on this note updates (a day it newly names), never a second line.
          const key = normalizeTaskWhat(rest);
          const hit = key ? findAllTasks(before, now).find((t) => !t.done && !t.reminder && (normalizeTaskWhat(t.words) === key || normalizeTaskWhat(t.text) === key)) : undefined;
          if (hit) {
            const lines = before.split(/\r?\n/);
            const eol = before.includes('\r\n') ? '\r\n' : '\n';
            const next = due ? updateNoteTaskLine(lines[hit.line], { iso: due.iso }, now) : lines[hit.line];
            const changed = next !== lines[hit.line];
            const words = changed ? alreadyThereWords(hit.text) : `already there: ${hit.text.replace(/\s+/g, ' ').trim().slice(0, 80)}`;
            if (!changed) return { text: words, done: { words, note: rel } };
            lines[hit.line] = next;
            const after = lines.join(eol);
            await this.host.writeNote(rel, after);
            return { text: words, done: { words, note: rel, undo: { kind: 'note-edited', path: rel, before, after } } };
          }
        }
        const after = heading ? appendUnder(before, [line], heading.replace(/[.*+?^${}()|[\]\\]/g, '')) : `${before.replace(/\s*$/, '')}${before.trim() ? '\n\n' : ''}${line}\n`;
        await this.host.writeNote(rel, after);
        return { text: `Added to ${rel}.`, done: { words: `Added a task to the note ${quote(titleOf(rel))}.`, note: rel, undo: { kind: 'note-edited', path: rel, before, after } } };
      }
      case 'note_replace': {
        const rel = this.existingNote(a.path);
        this.writableNote(rel);
        const before = index.content(rel) ?? (await this.host.notes.read(rel));
        const find = str(a.find, 100_000);
        if (!find) throw new Error('Give the exact text to replace in find.');
        const first = before.indexOf(find);
        if (first < 0) throw new Error('That text isn’t in the note. Read it again and copy the text exactly.');
        if (before.indexOf(find, first + 1) >= 0) throw new Error('That text is in the note more than once. Give a longer piece so it is found once.');
        const wrote = before.slice(0, first) + str(a.text, 100_000) + before.slice(first + find.length);
        // A bill's paid and due are kept by Mark paid (2 Nov 2026, the no-way-around pass): a change that moves
        // them keeps the old values, and the answer names the tool that does that change instead.
        const guarded = guardBillFreeText(before, wrote);
        await this.host.writeNote(rel, guarded.text);
        return { text: `Changed ${rel}.${guarded.note ? ` ${guarded.note}` : ''}`, done: { words: `Changed words in the note ${quote(titleOf(rel))}.`, note: rel, undo: { kind: 'note-edited', path: rel, before, after: guarded.text } } };
      }
      case 'note_delete': {
        const rel = this.existingNote(a.path);
        this.writableNote(rel);
        const before = index.content(rel) ?? (await this.host.notes.read(rel));
        await this.host.trash(rel);
        return { text: `Deleted ${rel} (to Recently deleted).`, done: { words: `Deleted the note ${quote(titleOf(rel))}.`, note: rel, undo: { kind: 'note-deleted', path: rel, text: before } } };
      }
      case 'capture': {
        const words = str(a.text, 20_000).replace(/\r\n/g, '\n').trim();
        if (!words) throw new Error('Give the words to capture.');
        const kind = a.kind === 'task' ? 'task' : 'note';
        const card = str(a.project, 300).trim() ? this.findProject(a.project) : null;
        const prefs = this.host.prefs();
        const now = new Date();
        const plan = planCapture({ kind, text: words, project: card ? { path: card.path, name: card.name, pcFolder: null } : null, pictures: 0, files: 0, toAssets: false, noProject: prefs.captureNoProject, dailyPath: this.host.dailyPath(), inboxPath: 'Inbox.md', attachmentsFor: () => '', now, ignoreDue: false });
        if (plan.nextStep && card) {
          // One task, one home (p12-task-writes): a captured step already open updates, never doubles.
          const { edits, said, wrote } = await this.planAdds(card, [{ what: plan.nextStep.what, ...(plan.nextStep.when ? { when: plan.nextStep.when } : {}), ...(plan.nextStep.more ? { more: plan.nextStep.more } : {}) }]);
          const fresh = `Captured a next step: ${quote(plan.nextStep.what)}${plan.due ? ` (by ${plan.due.words})` : ''}.`;
          if (!edits.length) {
            const words = said ?? fresh;
            const only = wrote.length === 1 ? wrote[0] : null;
            return { text: words, done: { words, project: { path: card.path, name: card.name }, ...(only ? { note: only.rel, undo: { kind: 'note-edited', path: only.rel, before: only.before, after: only.after } } : {}) } };
          }
          const out = await this.editProject(rec, card, edits, said ?? fresh);
          return { text: said ? out.text : `Added to ${card.name}’s next steps${plan.due ? `, by ${plan.due.words}` : ''}.`, done: out.done };
        }
        if (plan.newNote) {
          // A note of this name is already there: grow it instead of a " 2".
          const mine = captureNotePath(plan.newNote.folder, plan.newNote.title);
          const prior = index.content(mine) ?? ((await this.host.notes.exists(mine)) ? await this.host.notes.read(mine) : null);
          if (prior !== null && prior !== undefined) {
            const after = appendUnder(prior, captureLines(words, formatDate(prefs.timeFormat || 'HH:mm', now), []));
            await this.host.writeNote(mine, after);
            return { text: `Added to ${mine}.`, done: { words: `Added to the note ${quote(titleOf(mine))}.`, note: mine, ...(card ? { project: { path: card.path, name: card.name } } : {}), undo: { kind: 'note-edited', path: mine, before: prior, after } } };
          }
          const rel = await this.host.freeNote(plan.newNote.folder, plan.newNote.title);
          const body = noteText(words, [], card?.name ?? null, formatDate('YYYY-MM-DD HH:mm', now));
          await this.host.writeNote(rel, body);
          return { text: `Saved as ${rel}.`, done: { words: `Captured a note: ${quote(titleOf(rel))}.`, note: rel, ...(card ? { project: { path: card.path, name: card.name } } : {}), undo: { kind: 'note-made', path: rel, text: body } } };
        }
        if (plan.append) {
          const rel = plan.append.place === 'daily' ? await this.host.dailyNote() : plan.append.path;
          const before = index.content(rel) ?? ((await this.host.notes.exists(rel)) ? await this.host.notes.read(rel) : '');
          const lines = kind === 'task' && plan.what ? [taskLine(plan.what, plan.due, plan.rest)] : captureLines(words, formatDate(prefs.timeFormat || 'HH:mm', now), []);
          const after = appendUnder(before, lines);
          await this.host.writeNote(rel, after);
          const place = plan.append.place === 'daily' ? 'today’s note' : 'the Inbox';
          return { text: `Added to ${place} (${rel}).`, done: { words: `Captured ${kind === 'task' ? 'a task' : 'a note'} in ${place}: ${quote(kind === 'task' && plan.what ? plan.what : words.split('\n')[0])}.`, note: rel, undo: { kind: 'note-edited', path: rel, before, after } } };
        }
        throw new Error(kind === 'task' ? 'Write the task first.' : 'Write something to capture.');
      }
      // ── Where a file is, the tasks, today's calendar and a reminder (8.0 V1/TR3/V6/V7; src/shared/agent-reach.ts) ──
      case 'files_find':
        return { text: await this.filesFind(a) };
      case 'tasks_list':
        return { text: this.tasksList(a) };
      case 'calendar_get': {
        if (!this.host.calendar) throw new Error('No calendar is connected to Ironleaf.');
        const c = await this.host.calendar();
        if (!c.connected) return { text: json({ connected: false, why: CALENDAR_WHY[c.reason] ?? c.reason }) };
        return { text: json({ date: c.date, timeZone: c.timeZone, events: c.events.slice(0, 40).map((e) => ({ title: e.title, start: e.start, end: e.end, allDay: e.allDay || undefined, where: e.location || undefined, link: e.meetingLink || undefined })), ...(c.error ? { note: c.error } : {}) }) };
      }
      case 'reminder_set': {
        // The side chat's own set_reminder (src/main/agent.ts), writing through this call's gate: one meaning of "remind
        // me" wherever it is asked.
        const notes = this.host.notes;
        const writer = new AgentTools({ ...notes, write: (rel, t) => this.host.writeNote(rel, t), send: undefined, fileWrites: undefined }, [], () => {});
        const r = await writer.run({ id: randomUUID(), name: 'set_reminder', arguments: JSON.stringify({ what: str(a.what, 300), when: str(a.when, 200), ...(str(a.note, 400) ? { note: str(a.note, 400) } : {}), ...(typeof a.replace === 'boolean' ? { replace: a.replace } : {}) }) });
        if (r.isError) throw new Error(r.text);
        const first = writer.changes[0];
        const rel = first && 'path' in first ? first.path : undefined;
        return { text: r.text, ...(rel ? { done: { words: `Set a reminder: ${quote(str(a.what, 120), 90)}.`, note: rel } } : {}) };
      }
      case 'tidy_apply': {
        if (!this.host.tidy) throw new Error('The weekly tidy is not set up here.');
        const id = str(a.id, 80).replace(/^tidy:/, '').trim();
        if (!id) throw new Error('Say which tidy line (its id from tidy_list).');
        const words = await this.host.tidy.apply(id);
        return { text: words, done: { words: `Applied a tidy fix: ${quote(words, 90)}.` } };
      }
      // ── Files agents make, delivered into the project (or note) they are for ──
      case 'project_save_file':
      case 'note_attach_file':
        return this.saveFile(rec, name, a);
      case 'note_to_pdf':
        return this.noteToPdf(rec, a);
      case 'design_document':
        return this.designDocument(rec, a);
      default: {
        // A life module's tool (Wave 5), through this call's gate (the agent's levels; Health and Family-private refused
        // unless the person allowed them).
        const gate = callAgent.getStore()?.gate;
        if (this.host.modules && gate && this.host.modules.tools().some((t) => t.name === name)) return this.host.modules.call(gate, name, a);
        throw new Error(`There is no tool called ${name}.`);
      }
    }
  }
}
