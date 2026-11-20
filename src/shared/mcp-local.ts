// The Vault's own local MCP server for other AI apps (8.9, 31 Oct 2026: the Vault to match what rival notes apps can do).
// Claude Code, Claude Desktop, Cursor and VS Code on this PC run the app's own command ("neuralvault mcp", a stdio bridge
// in src/main/windows-entry.ts to /mcp on the local connection in src/main/cli.ts) and get the Vault as tools: search
// notes, read a note, list projects and tasks, add a note, add a task, append to a note, and each switched-on pack's
// record tools. Every call goes through the same dispatch agents use (src/main/agent-access.ts asLocalMcp): Private notes
// and secrets never readable, writes Undo-able and listed in What agents did, and the person's own switch (off until
// turned on) and Read only / Read and write honoured. This file is pure: the fixed tools, the per-app set-up JSON, and
// the words. The stdio speaking is src/main/mcp-local.ts.

import { AGENT_TOOLS, type AgentToolDef, type LocalMcpLevel, type LocalMcpSettings, type McpTool } from './agent-access';
import { MCP_EXTRA_TOOLS } from './mcp-tools';

/** The local server's lines in What agents did. */
export const LOCAL_MCP_ID = 'local-mcp';
export const LOCAL_MCP_NAME = 'Other AI apps';

/** Said to another app when its call cannot go through (plain words for its person, who reads them there). */
export const LOCAL_MCP_OFF = 'Connect an AI is switched off in Ironleaf (Settings › Connect an AI).';
export const LOCAL_MCP_READONLY = 'Connect an AI is set to Read only in Ironleaf (Settings › Connect an AI), so AI apps cannot change notes.';

/** Add a task: the one fixed tool agents do not have (their tasks go through projects or capture). A tick-box line
 *  appended to a note, like note_append but always a task. Carried out in dispatch (src/main/agent-access.ts). */
export const NOTE_ADD_TASK_DEF: AgentToolDef = {
  name: 'note_add_task',
  title: 'Add a task',
  level: 'edit',
  description: 'Add a task (a tick-box line) to the end of a note, or under one of its headings (made at the end when it isn’t there). Read the note first. On a person’s page or the hub it goes on the project instead and the page keeps a pointer; with no project it goes to the Inbox. A task already there updates, never doubles.',
  input: {
    path: { type: 'string', description: 'The note’s path or title.' },
    text: { type: 'string', description: 'The task’s words.' },
    heading: { type: 'string', description: 'Add it under this heading (optional).' },
  },
  required: ['path', 'text'],
};

/** Catalogue tools the local server never serves: deleting a whole folder is the person's to do in Ironleaf. */
export const LOCAL_MCP_LEFT_OUT: ReadonlySet<string> = new Set(['folder_delete']);

/** Words for AI apps where the agent catalogue's own speak of the former host app (Ironleaf stands on its own
here). */
const MCP_WORDS: Readonly<Record<string, [from: string, to: string][]>> = {
  files_search: [['; connected email too)', ')'], [' A project on a connected remote computer is searched by file name.', '']],
  file_read: [[', on this PC or on a connected remote computer', '']],
  project_files_list: [[', on this PC or on a connected remote computer', '']],
  calendar_get: [['the connected calendar (Google Calendar when it is connected)', 'the connected calendar']],
  asset_add: [[' (e.g. a picture an AI made)', '']],
  reminder_set: [[' A job to run by itself on a schedule is an automation instead.', '']],
};
function mcpWords(def: AgentToolDef): AgentToolDef {
  const swaps = MCP_WORDS[def.name];
  if (!swaps) return def;
  let description = def.description;
  for (const [from, to] of swaps) description = description.replace(from, to);
  return { ...def, description };
}

/** Every tool the local server can serve, read ones first: the agent catalogue's own definitions (so their words never
 *  drift from agents'), add a task, and the MCP-only tools (src/shared/mcp-tools.ts). */
export function localMcpCatalogue(): AgentToolDef[] {
  const all = [...AGENT_TOOLS.filter((t) => !LOCAL_MCP_LEFT_OUT.has(t.name)).map(mcpWords), NOTE_ADD_TASK_DEF, ...MCP_EXTRA_TOOLS];
  const seen = new Set<string>();
  const once = all.filter((t) => (seen.has(t.name) ? false : (seen.add(t.name), true)));
  return [...once.filter((t) => t.level === 'read'), ...once.filter((t) => t.level !== 'read')];
}

/** One catalogue tool by its name. */
export function localMcpDef(name: string): AgentToolDef | undefined {
  return CATALOGUE.get(name);
}

const CATALOGUE: ReadonlyMap<string, AgentToolDef> = new Map(localMcpCatalogue().map((d) => [d.name, d]));

/** Kept for older callers: the whole catalogue. */
export const localMcpFixedDefs = localMcpCatalogue;

/** Whether a tool sits inside a level: Read only serves the read tools; Read and write serves every tool. */
export function localLevelAllows(level: LocalMcpLevel, def: Pick<AgentToolDef, 'level'>): boolean {
  return level === 'edit' ? true : def.level === 'read';
}

/** A catalogue or pack tool as MCP lists it. */
export function mcpToolOf(def: Pick<AgentToolDef, 'name' | 'title' | 'description' | 'input' | 'required' | 'readOnly' | 'deletes'>): McpTool {
  return {
    name: def.name,
    title: def.title,
    description: def.description,
    inputSchema: { type: 'object', properties: def.input, ...(def.required?.length ? { required: [...def.required] } : {}), additionalProperties: false },
    annotations: { readOnlyHint: !!def.readOnly, destructiveHint: !!def.deletes, idempotentHint: !!def.readOnly, openWorldHint: false },
  };
}

/** Whether these settings allow this tool (off: nothing). Deletes go to the Bin and are listed with Undo. */
export function localMcpAllows(settings: LocalMcpSettings, def: Pick<AgentToolDef, 'name' | 'level' | 'deletes'>): boolean {
  if (!settings.on || LOCAL_MCP_LEFT_OUT.has(def.name)) return false;
  return localLevelAllows(settings.level, def);
}

/** The catalogue served at these settings (off: none are called, but tools/list still names the read ones so set-up
 *  reads right). */
export function localMcpTools(settings: LocalMcpSettings): AgentToolDef[] {
  return localMcpCatalogue().filter((d) => (settings.on ? localMcpAllows(settings, d) : localLevelAllows(settings.level, d)));
}

// ── Set-up: the exact JSON each app takes ─────────────────────────────────────────────────────────────────────────
// Claude Code, Claude Desktop and Cursor share the mcpServers shape (command/args, no type); VS Code reads a top-level
// servers key with type stdio. Each pasted whole into its file (the command is the real path on this PC). With the
// local URL switched on, the apps that take a URL get it with its token instead (Claude Desktop always runs the command).

export type McpSetupApp = 'claude-code' | 'claude-desktop' | 'cursor' | 'vscode' | 'chatgpt' | 'other';

export const MCP_SETUP_APPS: { id: McpSetupApp; name: string; file: string; words: string }[] = [
  { id: 'claude-code', name: 'Claude Code', file: '.mcp.json in the project', words: 'Paste into .mcp.json in the project (or ~/.claude.json for every project), or run the one-line command below, then restart Claude Code.' },
  { id: 'claude-desktop', name: 'Claude Desktop', file: 'claude_desktop_config.json', words: 'Settings › Developer › Edit Config opens claude_desktop_config.json (Windows: %APPDATA%\\Claude, macOS: ~/Library/Application Support/Claude, Linux: ~/.config/Claude). Paste this in, then restart Claude Desktop.' },
  { id: 'cursor', name: 'Cursor', file: '.cursor/mcp.json', words: 'Paste into .cursor/mcp.json in the project (or ~/.cursor/mcp.json for every project), then restart Cursor.' },
  { id: 'vscode', name: 'VS Code', file: '.vscode/mcp.json in the project', words: 'Paste into .vscode/mcp.json in the project (or run MCP: Add Server), then restart VS Code.' },
  { id: 'chatgpt', name: 'ChatGPT desktop', file: 'Settings › Connectors', words: 'ChatGPT adds MCP servers by URL (Settings › Connectors › Advanced › Developer mode, then Create). Switch on the local URL below and give it this address and token; ChatGPT apps that only reach the internet need a tunnel to this PC.' },
  { id: 'other', name: 'Other AI apps', file: 'its MCP settings', words: 'Any app that speaks MCP: run the command (stdio), or switch on the local URL and give it the address with the token as an Authorization: Bearer header.' },
];

/** The local URL's address and token, when it is switched on. */
export interface McpHttpSetup {
  url: string;
  token: string;
}

/** The exact JSON an app takes for the Vault (command: the ironleaf command's real path on this PC; http: the
 *  local URL, when switched on, for the apps that take one). */
export function mcpSetupJson(app: McpSetupApp, command: string, http?: McpHttpSetup | null): string {
  const entry = { command, args: ['mcp'] };
  const headers = http ? { Authorization: `Bearer ${http.token}` } : undefined;
  let doc: unknown;
  if (app === 'vscode') doc = { servers: { ironleaf: http ? { type: 'http', url: http.url, headers } : { type: 'stdio', ...entry } } };
  else if (app === 'claude-code') doc = { mcpServers: { ironleaf: http ? { type: 'http', url: http.url, headers } : entry } };
  else if (app === 'cursor') doc = { mcpServers: { ironleaf: http ? { url: http.url, headers } : entry } };
  else if (app === 'chatgpt' || app === 'other') doc = http ? { name: 'Ironleaf', url: http.url, headers } : { mcpServers: { ironleaf: entry } };
  else doc = { mcpServers: { ironleaf: entry } };
  return JSON.stringify(doc, null, 2);
}

/** Claude Code's one-line way to add it. */
export function mcpClaudeCodeCommand(command: string, http?: McpHttpSetup | null): string {
  if (http) return `claude mcp add --transport http ironleaf ${http.url} --header "Authorization: Bearer ${http.token}"`;
  const quoted = /\s/.test(command) ? `"${command}"` : command;
  return `claude mcp add ironleaf -- ${quoted} mcp`;
}

/** The local URL's port unless the person picks another. */
export const MCP_HTTP_PORT = 47731;
/** The local URL for a port. */
export const mcpHttpUrl = (port: number): string => `http://127.0.0.1:${port}/mcp`;

/** Every tool's name, for the record (docs and tests). */
export const LOCAL_MCP_TOOL_NAMES: readonly string[] = localMcpCatalogue().map((d) => d.name);
