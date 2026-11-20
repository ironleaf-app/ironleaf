// The Vault's MCP-only tools (20 Nov 2026, standalone, workstream B). The agent catalogue (src/shared/agent-access.ts,
// agent-full.ts, agent-reach.ts) already covers notes, projects, tasks, canvases, templates, assets, meetings and
// records; these fill the rest of what a person can do in Ironleaf: links and backlinks, the graph around a note, tags,
// properties, the meaning search, related notes, people, reminders, bookmarks, ticking a task and File recovery's
// versions. Carried out in src/main/mcp-tools.ts, through the same gate (Private notes never reached, changes listed in
// What agents did with Undo). Pure: the definitions only.

import type { AgentToolDef } from './agent-access';

const S = (description: string) => ({ type: 'string', description });
const N = (description: string) => ({ type: 'number', description });
const PATH = S('The note’s path (e.g. "Notes/Oven service.md") or its title.');

export const MCP_EXTRA_TOOLS: AgentToolDef[] = [
  {
    name: 'note_links',
    title: 'Links and backlinks',
    level: 'read',
    readOnly: true,
    description: 'The links in one note (to other notes, with the ones not written yet marked) and its backlinks: every note that links to it, with the line that links.',
    input: { path: PATH },
    required: ['path'],
  },
  {
    name: 'graph_neighbours',
    title: 'The graph around a note',
    level: 'read',
    readOnly: true,
    description: 'The graph around one note: the notes linked to or from it, and (depth 2) theirs, as nodes and links. Without a path: the most-linked notes in the library and how they join.',
    input: { path: PATH, depth: N('1 (default) or 2 steps out.'), limit: N('At most this many notes (default 60, at most 300).') },
  },
  {
    name: 'tags_list',
    title: 'Tags',
    level: 'read',
    readOnly: true,
    description: 'Every tag in the library with how many notes carry it, most used first. Search a tag with vault_search and tag:#name.',
    input: {},
  },
  {
    name: 'note_properties',
    title: 'A note’s properties',
    level: 'read',
    readOnly: true,
    description: 'A note’s properties (the YAML at its top) as JSON: tags, status, dates, people and the rest. Change them with note_set_properties.',
    input: { path: PATH },
    required: ['path'],
  },
  {
    name: 'meaning_search',
    title: 'Search by meaning',
    level: 'read',
    readOnly: true,
    description: 'Search the notes by what they mean, not only their words (the on-device meaning index; word matches first, then notes that say the same thing in other words). Each hit has its path, title and the matching lines.',
    input: { query: S('What to look for, in plain words.'), limit: N('At most this many notes (default 10, at most 50).') },
    required: ['query'],
  },
  {
    name: 'related_notes',
    title: 'Related notes',
    level: 'read',
    readOnly: true,
    description: 'The notes most related to one note: by links both ways, shared tags and shared words.',
    input: { path: PATH, limit: N('At most this many (default 10, at most 30).') },
    required: ['path'],
  },
  {
    name: 'reminders_list',
    title: 'Reminders',
    level: 'read',
    readOnly: true,
    description: 'Every reminder set in the notes (a task line with a ⏰ time), with its note and when it is due. Set one with reminder_set.',
    input: {},
  },
  {
    name: 'bookmarks_list',
    title: 'Bookmarks',
    level: 'read',
    readOnly: true,
    description: 'The person’s bookmarks: the notes, searches and folders they keep at hand.',
    input: {},
  },
  {
    name: 'people_list',
    title: 'People',
    level: 'read',
    readOnly: true,
    description: 'The people the library has a page for (a note typed person, or kept in People or Contacts): each with its path and name. What is open with one of them: person_open_items; everything joined to them: connected_to.',
    input: {},
  },
  {
    name: 'note_versions',
    title: 'A note’s earlier versions',
    level: 'read',
    readOnly: true,
    description: 'The earlier versions File recovery keeps of a note, newest first: each with its id, when it was kept and its size. Read one with note_version_read.',
    input: { path: PATH },
    required: ['path'],
  },
  {
    name: 'note_version_read',
    title: 'Read an earlier version',
    level: 'read',
    readOnly: true,
    description: 'The text of one earlier version of a note (its id from note_versions).',
    input: { path: PATH, id: S('The version’s id from note_versions.') },
    required: ['path', 'id'],
  },
  {
    name: 'note_version_restore',
    title: 'Restore an earlier version',
    level: 'edit',
    description: 'Put a note back as it was in an earlier version (its id from note_versions). The text it has now is kept as a version too, and the change can be undone in Ironleaf.',
    input: { path: PATH, id: S('The version’s id from note_versions.') },
    required: ['path', 'id'],
  },
  {
    name: 'task_set_done',
    title: 'Tick or untick a task',
    level: 'edit',
    description: 'Tick a task off (or untick it) in the note that holds it: only its box changes, the words stay as written. Find tasks with tasks_list. A project’s next step is ticked with project_tick_next_step instead.',
    input: { path: PATH, text: S('The task’s words (all of them, or enough to name one task in the note).'), done: { type: 'boolean', description: 'true (default) ticks it; false unticks it.' } },
    required: ['path', 'text'],
  },
  {
    name: 'note_rename',
    title: 'Rename a note',
    level: 'edit',
    description: 'Give a note a new name in the same folder. Links to it are brought up to date. To move it to another folder use note_move.',
    input: { path: PATH, name: S('The new name, without .md.') },
    required: ['path', 'name'],
  },
];

/** The MCP-only tools' names. */
export const MCP_EXTRA_NAMES: ReadonlySet<string> = new Set(MCP_EXTRA_TOOLS.map((t) => t.name));
