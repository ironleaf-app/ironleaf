// What other AI apps may do in Ironleaf (4.9.5, 17 Oct 2026): the parts that are only data and words: the tool levels,
// every tool an AI app may call (its level, JSON Schema and a description written for that app), the local MCP server's
// settings, and what Settings › Connect an AI and What agents did show. The main side (src/main/agent-access.ts) carries
// the calls out; the local MCP server (src/main/mcp-local.ts) and the side chat (src/main/ai.ts) call it.

import { FULL_TOOLS, READ_EXTRA_TOOLS } from './agent-full';
import { REACH_TOOLS } from './agent-reach';
import { RECORD_TOOLS } from './records';
import type { DeliveredFile } from './agent-files';

/** A tool's level: what it may do (Read only serves the read ones; Read and write serves every one). */
export type AgentLevel = 'read' | 'edit' | 'full';

/** More changes than this in one call is refused in words (split it into smaller calls). */
export const BATCH_LIMIT = 10;
/** The longest answer an agent gets in one call (characters); longer ones say how to ask for less. */
export const ANSWER_CHARS = 14_000;
/** A note read in parts: each part's length (characters). */
export const PART_CHARS = 12_000;
// The defaults and most an agent may ask for at once.
export const SEARCH_LIMIT = 10;
export const SEARCH_MAX = 30;
export const LIST_LIMIT = 60;
export const LIST_MAX = 200;
export const RECENT_DAYS = 7;
export const RECENT_LIMIT = 40;
export const RECENT_MAX = 100;
export const ASSET_LIMIT = 30;
export const ASSET_MAX = 60;
export const FILE_SEARCH_LIMIT = 10;
export const FILE_SEARCH_MAX = 20;
/** A note with no words in it, in one voice on both sides. */
export const EMPTY_NOTE = '(empty note)';

/** A search that finds nothing, in one voice on every door (2 Nov 2026, seams O3: the side chat said "Nothing
 *  matches" where the former host app says "Nothing in Ironleaf matches"). Shared with the former host app
 *  through the catalogue module, so its own vault_search answers word for word the same. */
export function noSearchMatchWords(query: string): string {
  return `Nothing in Ironleaf matches “${query}”. Try other words.`;
}

export type ActivityOutcome = 'done' | 'denied' | 'expired' | 'failed';

export interface ActivityView {
  id: string;
  at: number;
  agentId: string;
  agentName: string;
  tool: string;
  words: string;
  project?: { path: string; name: string };
  note?: string;
  outcome: ActivityOutcome;
  canUndo: boolean;
  undone: boolean;
  /** A file the agent delivered (project_save_file, note_attach_file): its card. */
  file?: DeliveredFile;
}

/** Settings › Connect an AI and What agents did, as the window reads them. */
export interface AgentsState {
  host: 'standalone' | 'embedded';
  activity: ActivityView[];
  /** The person's name ("Sam"), else null. */
  person: string | null;
  /** Files agents delivered in the last two weeks, newest first. */
  delivered: DeliveredFile[];
  /** Other AI apps on this PC, through Ironleaf's own local MCP server. */
  localMcp: LocalMcpSettings;
  /** The local URL for apps that take one (absent where the app has none, such as the tests). */
  localMcpHttp?: LocalMcpHttpView;
  /** The program other AI apps run with the word mcp, where it isn't the Windows ironleaf command. */
  localMcpCommand?: string;
}

/** What other AI apps on this PC may do through the Vault's local MCP server (8.9, 31 Oct 2026: the Vault to match what
 *  rival notes apps can do): Read only, or Read and write. Off until the person switches it on. */
export type LocalMcpLevel = 'read' | 'edit';
export interface LocalMcpSettings {
  on: boolean;
  level: LocalMcpLevel;
  /** The local URL (Streamable HTTP on 127.0.0.1, with a token) for apps that take a URL; off until switched on. */
  http?: boolean;
  /** Its port (47731 unless the person picks another). */
  port?: number;
}
export const DEFAULT_LOCAL_MCP: LocalMcpSettings = { on: false, level: 'read' };
/** Stored settings read back (an older file has none: off, Read only, no URL). */
export function cleanLocalMcp(raw: unknown): LocalMcpSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<LocalMcpSettings>;
  const port = typeof r.port === 'number' && Number.isInteger(r.port) && r.port >= 1024 && r.port <= 65535 ? r.port : undefined;
  return { on: r.on === true, level: r.level === 'edit' ? 'edit' : 'read', ...(r.http === true ? { http: true } : {}), ...(port ? { port } : {}) };
}

/** The local URL as the window shows it (the token only to the person's own window). */
export interface LocalMcpHttpView {
  on: boolean;
  url: string;
  token: string;
  /** Why it isn't listening, in words (the port is taken…). */
  problem?: string;
}

export interface McpTool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean };
}

export interface AgentToolDef {
  name: string;
  title: string;
  level: AgentLevel;
  description: string;
  input: Record<string, unknown>;
  required?: string[];
  /** Deletes something (it goes to the Bin, with Undo). */
  deletes?: boolean;
  /** Arguments that are lists of changes (more than BATCH_LIMIT in one call is refused). */
  batch?: string[];
  /** Changes nothing. */
  readOnly?: boolean;
}

const S = (description: string) => ({ type: 'string', description });
const N = (description: string) => ({ type: 'number', description });
const PROJECT = S('The project’s name as projects_list gives it (or its path).');
const LIST_ITEM = {
  type: 'object',
  description: 'For dates: {when, what, status?}. risks: {what, level: low|medium|high}. decisions: {what, why?, date?}. people: {name, role?}. documents: {path (inside the project’s folder), what}.',
  additionalProperties: true,
};

/** Every tool an agent may call, from the least it can do to the most. */
export const AGENT_TOOLS: AgentToolDef[] = [
  // ── Read ──
  {
    name: 'vault_overview',
    title: 'How the library is laid out',
    level: 'read',
    readOnly: true,
    description: 'Start here. How this Ironleaf library is laid out: its folders and how many notes each holds, the tags and properties in use, every project (name, status, health), and today’s date. Private notes are never open to agents.',
    input: {},
  },
  {
    name: 'vault_search',
    title: 'Search the notes',
    level: 'read',
    readOnly: true,
    description: 'Search the notes by their words. All words must appear; "quoted phrases", OR, -word, tag:#name, path:folder and [property:value] work. Returns each note’s path with its matching lines. Pictures and scanned PDFs among the notes match by the words read in them too. Try other words before deciding something isn’t written down; read a whole note with note_read.',
    input: { query: S('What to look for.'), limit: N('At most this many notes (default 10, at most 30).') },
    required: ['query'],
  },
  {
    name: 'note_read',
    title: 'Read a note',
    level: 'read',
    readOnly: true,
    description: 'Read one note in full (Markdown, its properties first). Give its path from vault_search, notes_list or a project (or its title). A picture or a scanned PDF reads as the words recognised in it; a Word, Excel, PowerPoint, PDF or text file among the notes reads as its document words. A long note comes in parts of about 12,000 characters: ask for part 2, 3… for more.',
    input: { path: S('The note’s path, e.g. "Meetings/Harbour site meeting.md", or its title.'), part: N('Which part of a long note (1 is the start).') },
    required: ['path'],
  },
  {
    name: 'notes_list',
    title: 'List a folder',
    level: 'read',
    readOnly: true,
    description: 'The notes in a folder (each one’s path and the day it last changed, newest first) and the folders inside it. folder "" is the top of the library.',
    input: { folder: S('A folder in the library ("" for the top).'), sort: { type: 'string', enum: ['recent', 'name'] }, limit: N('At most this many (default 60).') },
  },
  {
    name: 'notes_recent',
    title: 'Notes changed lately',
    level: 'read',
    readOnly: true,
    description: 'The notes changed in the last days, newest first: for “lately”, “this week”, “what was I working on”.',
    input: { days: N('Default 7.'), limit: N('At most this many (default 40).') },
  },
  {
    name: 'projects_list',
    title: 'Every project',
    level: 'read',
    readOnly: true,
    description: 'Every project at a glance, as compact JSON: name, status, health, progress, owner, due date, open next steps with the first one, and the top risk. Done projects are left out unless asked for. Use a project’s name with project_get and the project tools.',
    input: { include_done: { type: 'boolean', description: 'Include finished projects too.' } },
  },
  {
    name: 'project_get',
    title: 'One project in full',
    level: 'read',
    readOnly: true,
    description: 'One project in full, as compact JSON: its facts, summary, next steps (numbered: use the number to tick one off or remove it), key dates, people, risks, the latest decisions and updates, pinned documents, and how many notes and activity it has.',
    input: { project: PROJECT },
    required: ['project'],
  },
  {
    name: 'today_get',
    title: 'Today',
    level: 'read',
    readOnly: true,
    description: 'The person’s day across every project, as compact JSON: next steps and key dates overdue, due today and due in the next 7 days, projects at risk and why, what they are waiting on others for, and today’s meetings. Good for “what’s on today”, “what’s at risk”, “what am I waiting on”.',
    input: {},
  },
  {
    name: 'timeline_get',
    title: 'The timeline',
    level: 'read',
    readOnly: true,
    description: 'Dates across the projects in a window (default 14 days back to 60 days ahead): starts, due dates, key dates, next steps, decisions and updates; and what needs a look: clashes (two dates on one day that share people), next steps due after their project is, and dates passed without being done.',
    input: { project: S('Keep to one project (its name).'), days_back: N('Days before today (default 14).'), days_ahead: N('Days after today (default 60).') },
  },
  {
    name: 'files_search',
    title: 'Search project files',
    level: 'read',
    readOnly: true,
    description: 'Search inside the documents in the projects’ folders on this PC (Word, Excel, PowerPoint, PDF, text, CSV; connected email too): quotes, status reports, plans, minutes. Words match the file’s name, folder and words. A project on a connected remote computer is searched by file name. Returns each file with its project, dates and the lines where the words are; then file_read for the whole of one.',
    input: { query: S('What to look for.'), project: S('Keep to one project (its name).'), limit: N('At most this many files (default 10).') },
    required: ['query'],
  },
  {
    name: 'file_read',
    title: 'Read a project file',
    level: 'read',
    readOnly: true,
    description: 'Read the words of one file in a project’s folder, on this PC or on a connected remote computer (its project and its path from files_search or project_get). A long file comes in parts: ask for part 2, 3… for more. Never changes the file.',
    input: { project: PROJECT, path: S('The file’s path inside the project’s folder.'), part: N('Which part of a long file (1 is the start).') },
    required: ['project', 'path'],
  },
  {
    name: 'meetings_list',
    title: 'Recent meetings',
    level: 'read',
    readOnly: true,
    description: 'Meeting notes from the last days, newest first: path, day, project, and how many actions in each are not yet a project’s next step.',
    input: { days: N('Default 30.'), limit: N('At most this many (default 15).') },
  },
  {
    name: 'meeting_actions',
    title: 'A meeting’s actions',
    level: 'read',
    readOnly: true,
    description: 'The actions in one meeting note, read plainly (what, who, by when), and which are already in a project. Add one to a project with project_add_next_step.',
    input: { note: S('The meeting note’s path or title.') },
    required: ['note'],
  },
  // The connected vault (src/shared/records.ts; WS1 part B): the same questions Ironleaf's own assistant asks.
  ...RECORD_TOOLS.map(
    (t): AgentToolDef => ({
      name: t.name,
      title: t.name === 'connected_to' ? 'Everything joined to something' : t.name === 'person_open_items' ? 'What’s open with someone' : 'A meeting’s items',
      level: 'read',
      readOnly: true,
      description: t.description,
      input: t.parameters.properties as Record<string, unknown>,
      ...('required' in t.parameters ? { required: [...t.parameters.required] } : {}),
    }),
  ),
  {
    name: 'reviews_list',
    title: 'Weekly reviews',
    level: 'read',
    readOnly: true,
    description: 'The weekly reviews written, newest first (read one with note_read), and when the last one was done.',
    input: {},
  },
  {
    name: 'templates_list',
    title: 'Templates',
    level: 'read',
    readOnly: true,
    description: 'The library’s templates: for notes (meeting notes, a status update…), for projects (the shape a new project starts with: use its path with project_create) and for reports. Name, what each is for and its path.',
    input: { group: { type: 'string', enum: ['notes', 'projects', 'reports'] } },
  },
  {
    name: 'brand_kit_get',
    title: 'The brand kit',
    level: 'read',
    readOnly: true,
    description: 'The business’s brand kit: its logos by role (primary, on dark backgrounds, icon), colours (hex and name) and fonts. Use the primary logo unless the background is dark.',
    input: {},
  },
  {
    name: 'assets_search',
    title: 'Find assets',
    level: 'read',
    readOnly: true,
    description: 'Find files in the asset store (the library’s logos, pictures, icons, documents, video and audio) by name, tags, collections and description.',
    input: { query: S('Words to find (leave out to list everything of a kind).'), kind: { type: 'string', enum: ['logo', 'image', 'icon', 'document', 'media', 'other'] }, limit: N('At most this many (default 30).') },
  },
  {
    name: 'tidy_list',
    title: 'This week’s tidy list',
    level: 'read',
    readOnly: true,
    description: 'The weekly tidy’s waiting lines: duplicate notes to merge, broken links, empty and thin notes, notes in the wrong place and stale reminders, each with its id and what applying it does. Reading changes nothing. Apply one with tidy_apply.',
    input: {},
  },
  // ── Edit ──
  {
    name: 'project_create',
    title: 'Start a project',
    level: 'edit',
    description: 'Start a new project: one project file, Projects/<Name>/<Name>.md, from a project template (its path from templates_list) when given, with a short summary. Fails if a project with that name is already there.',
    input: { name: S('The project’s name as people say it.'), summary: S('What it is and who it is for, in 2 to 5 plain sentences.'), template: S('A project template’s path (optional).') },
    required: ['name'],
  },
  {
    name: 'project_set_field',
    title: 'Change a project’s fact',
    level: 'edit',
    description: 'Change one fact of a project: status (idea, planning, active, on hold, done), health (on track, at risk, off track), progress (0 to 100), owner, started or due (a date such as 2026-11-30), or summary (2 to 5 plain sentences). An empty value clears it. Marking done with open tasks answers with them for the person to settle instead of closing.',
    input: { project: PROJECT, field: { type: 'string', enum: ['status', 'health', 'progress', 'owner', 'started', 'due', 'summary'] }, value: { type: ['string', 'number', 'null'] } },
    required: ['project', 'field', 'value'],
  },
  {
    name: 'project_add_next_step',
    title: 'Add a next step',
    level: 'edit',
    description: 'Add a next step to a project: one short action someone does (verb first, under 25 words), who does it (a person, never a day) and by when. A meeting or a deadline that is not an action is a key date (project_add_item). Read project_get first, and tick off (project_tick_next_step) the ones that are done. A step already there (open on the project or in its notes, in any words) is updated, never doubled; a relative day becomes a real date. Several at once with steps (more than 10 in one call waits for the person to allow it).',
    input: {
      project: PROJECT,
      what: S('The step, short, starting with a verb.'),
      who: S('Who does it.'),
      when: S('By when: a date such as 2026-10-24 or words such as “Fri 24 Oct”.'),
      steps: { type: 'array', items: { type: 'object', properties: { what: { type: 'string' }, who: { type: 'string' }, when: { type: 'string' } }, required: ['what'] }, description: 'Several steps instead of one.' },
    },
    required: ['project'],
    batch: ['steps'],
  },
  {
    name: 'project_tick_next_step',
    title: 'Tick off a next step',
    level: 'edit',
    description: 'Tick off a next step (done false puts it back on the list). step is its number from project_get, or its words.',
    input: { project: PROJECT, step: { type: ['number', 'string'], description: 'Its number from project_get (1 is the first), or its words.' }, done: { type: 'boolean', description: 'Default true.' } },
    required: ['project', 'step'],
  },
  {
    name: 'project_log_update',
    title: 'Log an update',
    level: 'edit',
    description: 'Add a line to a project’s Updates (newest first): what happened and what it changes, in one or two plain sentences (under 50 words), and the document or source it came from. Detail goes in a note named in from. The date is today unless given.',
    input: { project: PROJECT, what: S('What happened.'), from: S('The document or source it came from.'), date: S('When, if not today.') },
    required: ['project', 'what'],
  },
  {
    name: 'project_add_item',
    title: 'Add to a project’s list',
    level: 'edit',
    description: 'Add to a project’s other lists: a key date, a risk, a decision, a person, or a pinned document. Several at once with items (more than 10 in one call waits for the person to allow it).',
    input: { project: PROJECT, list: { type: 'string', enum: ['dates', 'risks', 'decisions', 'people', 'documents'] }, item: LIST_ITEM, items: { type: 'array', items: LIST_ITEM } },
    required: ['project', 'list'],
    batch: ['items'],
  },
  {
    name: 'project_change_item',
    title: 'Change a line of a project',
    level: 'edit',
    description: 'Change one line of a project’s list by its number from project_get: for example close a risk {closed: true}, mark a key date {status: "done"}, or reword a step {what}. Only the parts given change.',
    input: { project: PROJECT, list: { type: 'string', enum: ['next', 'dates', 'risks', 'decisions', 'people', 'documents', 'updates'] }, number: N('The line’s number from project_get (1 is the first).'), item: { type: 'object', additionalProperties: true } },
    required: ['project', 'list', 'number', 'item'],
  },
  {
    name: 'project_remove_item',
    title: 'Remove a line of a project',
    level: 'edit',
    description: 'Remove one line from a project’s list by its number from project_get. Removing waits for the person to allow it.',
    input: { project: PROJECT, list: { type: 'string', enum: ['next', 'dates', 'risks', 'decisions', 'people', 'documents', 'updates'] }, number: N('The line’s number from project_get (1 is the first).') },
    required: ['project', 'list', 'number'],
    deletes: true,
  },
  {
    name: 'note_create',
    title: 'Make a note',
    level: 'edit',
    description: 'Make a new note. path is from the top of the library, with folders (made as needed), e.g. "Projects/Studio Upgrade/Notes/Gear audit.md". Markdown; properties first as YAML between --- lines; link notes as [[Note title]]. Search and read first: when a note for this already exists, update it in place (note_append, note_edit) instead of making another. Fails if the note is there (then use note_append).',
    input: { path: S('Where the note goes, ending in .md.'), content: S('The note, in Markdown.') },
    required: ['path', 'content'],
  },
  {
    name: 'note_append',
    title: 'Add to a note',
    level: 'edit',
    description: 'Add text to the end of a note, or under one of its headings (made at the end when it isn’t there). Read the note first.',
    input: { path: S('The note’s path or title.'), text: S('What to add, in Markdown.'), heading: S('Add it under this heading (optional).') },
    required: ['path', 'text'],
  },
  {
    name: 'note_replace',
    title: 'Change words in a note',
    level: 'edit',
    description: 'Replace one exact piece of a note’s text (find must appear exactly once). Read the note first. On a bill note, paid and due stay as they are: a payment is recorded with Mark paid (finance_bill_mark_paid), and the day it falls is changed with finance_bill_add.',
    input: { path: S('The note’s path or title.'), find: S('The exact text to replace.'), text: S('What goes there instead.') },
    required: ['path', 'find', 'text'],
  },
  {
    name: 'note_delete',
    title: 'Delete a note',
    level: 'edit',
    description: 'Delete a note (to the Bin; File recovery keeps a copy). Waits for the person to allow it.',
    input: { path: S('The note’s path or title.') },
    required: ['path'],
    deletes: true,
  },
  {
    name: 'capture',
    title: 'Capture',
    level: 'edit',
    description: 'Capture a thought or a task as Quick capture does. A task for a project becomes its next step (a day in the words, like “by Friday”, becomes its due date); a note for a project becomes a note in the project’s folder; without a project it goes into today’s note (or the Inbox, as the person chose). A task already there is updated, never doubled.',
    input: { text: S('The words, as the person would type them.'), kind: { type: 'string', enum: ['task', 'note'], description: 'Default note.' }, project: S('The project it is for (optional).') },
    required: ['text'],
  },
  {
    name: 'project_save_file',
    title: 'Save a file into a project',
    level: 'edit',
    description:
      'Deliver a file you made (PDF, Word, PowerPoint, Excel, pictures, CSV, Markdown, zip…) into a project, so the person finds it there. Always use this when you make anything for a project: a file left on your own computer never reaches them. It goes into the project’s folder on their PC (else the project’s own Files in Ironleaf) and shows as a card with its first page on Today and on the project. Give name (with its extension) and what (one short line on what it is). Small files in one call: content (plain text) or base64 (up to 600 KB of base64). Bigger files (up to 4 GB) in parts: step "begin" with name, size and sha256 → an upload_id; then step "append" with upload_id, index (0, 1, 2…) and base64 (each part at most 600 KB of base64); then step "finish" with upload_id and sha256. A broken upload carries on: step "status" says which part comes next. If you have a shell where the file is, "begin" also gives a ready command that sends the parts for you. A name already there gets a new name (“Report (2).pdf”); new_version: true makes it the newer version of the file of that name in Ironleaf (the one there is kept as v1, v2…, links reach the new one); replace: true overwrites only at Full control. A file already on the person’s PC that should stay where it is (too big to send, or kept in its own place): reference with its whole path links it to the project without copying it. Then tell the person the project and the file’s name in one line: the card does the talking, so don’t paste the file’s contents into your reply.',
    input: {
      project: PROJECT,
      name: S('The file’s name with its extension, e.g. "Harbour Lane closeout report.pdf".'),
      what: S('One short line on what it is, for its card (e.g. "6-page closeout report for the client").'),
      content: S('The whole file as plain text (Markdown, CSV, HTML, JSON…), for a small text file in one call.'),
      base64: S('The whole file (one call, up to 600 KB of base64), or one part (step "append").'),
      from: S('A full path on this PC to copy from (only when you run on the same PC).'),
      step: { type: 'string', enum: ['begin', 'append', 'finish', 'status', 'cancel'], description: 'For a file sent in parts. Leave out to send the whole file in this call.' },
      size: N('begin: the whole file’s size in bytes.'),
      sha256: S('begin and finish: the whole file’s SHA-256, hex (checked when it is put together).'),
      upload_id: S('append, finish, status, cancel: the id begin gave.'),
      index: N('append: which part this is (0 is the first).'),
      folder: S('A folder inside the project’s folder to put it in, e.g. "Reports" (optional).'),
      replace: { type: 'boolean', description: 'Overwrite a file with the same name (Full control only; otherwise it is saved under a new name).' },
      new_version: { type: 'boolean', description: 'This is a newer version of the file of the same name: the one there is kept as an older version (v1, v2…) and links reach this one (in Ironleaf’s own Files; a project’s folder on the PC gets a new name instead).' },
      reference: S('A file already on the person’s PC, linked where it is (nothing copied or sent): its whole path, e.g. C:\\Users\\…\\Survey.xlsx.'),
      source_url: S('Where the file came from, when it came from the web (kept as its source).'),
      by: S('Your own name as an agent (optional: shown on the card when Ironleaf knows you by it).'),
    },
    required: [],
  },
  {
    name: 'note_attach_file',
    title: 'Attach a file to a note',
    level: 'edit',
    description:
      'Attach a file to a note (a meeting, a person, any note): it is saved in the Files folder beside the note, with who sent it and when, and a link to it is added at the end of the note. Same ways of sending as project_save_file (content, base64, the steps begin / append / finish with upload_id, new_version, or reference for a file on the PC that stays where it is). For anything made for a project, use project_save_file instead.',
    input: {
      note: S('The note’s path or title.'),
      name: S('The file’s name with its extension.'),
      what: S('One short line on what it is.'),
      content: S('The whole file as plain text, for a small text file.'),
      base64: S('The whole file (up to 600 KB of base64), or one part (step "append").'),
      from: S('A full path on this PC to copy from (only when you run on the same PC).'),
      step: { type: 'string', enum: ['begin', 'append', 'finish', 'status', 'cancel'] },
      size: N('begin: the whole file’s size in bytes.'),
      sha256: S('begin and finish: the whole file’s SHA-256, hex.'),
      upload_id: S('append, finish, status, cancel: the id begin gave.'),
      index: N('append: which part this is (0 is the first).'),
      new_version: { type: 'boolean', description: 'This is a newer version of the note’s file of the same name: the one there is kept as an older version.' },
      reference: S('A file already on the person’s PC, linked where it is (nothing copied): its whole path.'),
      source_url: S('Where the file came from, when it came from the web (kept as its source).'),
      by: S('Your own name as an agent (optional).'),
    },
    required: [],
  },
  {
    name: 'note_to_pdf',
    title: 'Make a branded PDF',
    level: 'edit',
    description:
      'This is how a person’s note becomes a finished branded PDF, set in their brand kit (their logo, colours and fonts): the PDF they asked for (“make this a PDF”, “the minutes as a PDF”, “send me that as a PDF”). Give the note by its path or title. It is laid out as the same branded document Export to PDF prints, kept in the note’s Files as a new version (the one before is kept), and the answer gives the file with its page count — hand it over from there. Without a brand kit the neutral document still comes. A note only: making a new designed document that is not a note stays with the design tools.',
    input: { note: S('The note’s path or title.') },
    required: ['note'],
  },
  {
    name: 'design_document',
    title: 'Design a document',
    level: 'edit',
    description:
      'This is how a person’s note becomes a designed document in their brand kit, laid out by the AI, printed and checked page by page: a report (a designed cover, then every word), a one-pager, a proposal, a handout (two pages), a poster, or slides (16:9). Use it when they ask for one of these (“turn this into a one-pager”, “make slides from the plan”, “design a proposal for the board”); a plain PDF of the note is note_to_pdf’s. Give the note by its path or title, the kind, and the brief in their words (who it is for, what to lead with). It takes a minute or two. The PDF is kept in the note’s Files (a new version when there was one) and the answer gives the file with its pages — hand it over from there.',
    input: { note: S('The note’s path or title.'), kind: { type: 'string', enum: ['report', 'one-pager', 'proposal', 'handout', 'poster', 'slides'], description: 'What to make.' }, brief: S('What the person asked for, in their words: who it is for, what to lead with, the tone (optional).') },
    required: ['note', 'kind'],
  },
  {
    name: 'tidy_apply',
    title: 'Apply a tidy fix',
    level: 'edit',
    description: 'Apply one waiting line of the weekly tidy (its id from tidy_list): the duplicate merges with every line kept, the link fixed, the empty or thin note moved to the Bin, the note moved with its links kept working, or the stale reminder marked done. Each change undoes from the Weekly tidy tab.',
    input: { id: S('The line’s id from tidy_list (duplicate-1, or tidy:duplicate-1 as Needs you gives it).') },
    required: ['id'],
  },
];

// The one catalogue (src/shared/vault-tools.ts) is this list: what every AI reaching Ironleaf has, at its level.
AGENT_TOOLS.push(...READ_EXTRA_TOOLS, ...FULL_TOOLS, ...REACH_TOOLS);

export const toolDef = (name: string) => AGENT_TOOLS.find((t) => t.name === name);

/** How many changes a call makes at once (its lists, else one). */
export function changeCount(def: AgentToolDef, args: Record<string, unknown>): number {
  let n = 0;
  for (const k of def.batch ?? []) if (Array.isArray(args[k])) n += (args[k] as unknown[]).length;
  return n || 1;
}

/** A long answer cut to size, saying how to get the rest. */
export function capText(text: string, max = ANSWER_CHARS, more = 'ask for less (a narrower search, a smaller limit, or the next part)'): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n… (cut short here at ${max.toLocaleString('en-AU')} characters: ${more})`;
}

/** Part `part` of a long text, with where it is ("part 1 of 3: ask for part 2 for more"). */
export function partOf(text: string, part: number, size = PART_CHARS): { text: string; parts: number } {
  const parts = Math.max(1, Math.ceil(text.length / size));
  if (part > parts) return { text: `There ${parts === 1 ? 'is 1 part' : `are ${parts} parts`}.`, parts };
  const piece = text.slice((part - 1) * size, part * size);
  return { text: parts > 1 ? `${piece}\n… (part ${part} of ${parts}${part < parts ? `: ask for part ${part + 1} for more` : ''})` : piece, parts };
}
