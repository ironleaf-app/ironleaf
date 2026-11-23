// One vault tool catalogue for every AI (8.0 V1 and TR3, 28 Oct 2026). The audit (docs/audit-8.0/vault.md §1.3): "three
// vocabularies, one vault": Ironleaf's side chat, outside agents over MCP and the former host app (its conversations, a
// chat bot and its bots) each had their own vault tools, so each new vault feature reached one of them (canvas only over
// MCP, reminders only in the side chat, Today and the timeline only over MCP, areas in none). 28 Oct. Now there is one
// list: every tool an outside agent has (src/shared/agent-access.ts AGENT_TOOLS, with agent-full.ts and agent-reach.ts),
// each with its name, level, JSON Schema and words, carried out in one place (src/main/agent-access.ts dispatch). Three
// consumers read it:
//  - mcp: outside agents, at the level the person gave each (toolsFor);
//  - spark: The former host app's conversations, a chat bot and its bots, built into the former host app's desktop plugin
//    (native-runtime/plugins/desktop/vault-tools.mjs, by tools/build-embedded.mjs) and called through the former host
//    app's ask
//    channel, each tool registered with its own schema;
//  - side: Ironleaf's own side chat (src/main/ai.ts).
// A consumer that already has its own tool for something (woven into its own Undo, cards and gate) keeps it, and the
// catalogue says which (OWN), so other tools' words name it; every other catalogue tool is served to it. A new vault tool
// is added to the catalogue once, with its handler in dispatch, and reaches all three.

import { AGENT_TOOLS, type AgentLevel, type AgentToolDef } from './agent-access';

export type Consumer = 'mcp' | 'spark' | 'side';
export type OwnConsumer = Exclude<Consumer, 'mcp'>;

/** The catalogue: every vault tool, once, from the least it can do to the most. */
export const VAULT_TOOLS: readonly AgentToolDef[] = AGENT_TOOLS;

/** Catalogue tools a consumer does with a tool of its own, by that tool's name. */
export const OWN: Record<OwnConsumer, Record<string, string>> = {
  // The former host app's own vault tools (native-runtime/plugins/desktop: vault-reach, vault-notes, vault-docs,
  // vault-attach) read and write the library on this PC with the former host app's Rewind, its reply cards and its gate;
  // its automations are its own.
  spark: {
    vault_search: 'vault_search',
    note_read: 'vault_read',
    projects_list: 'vault_projects',
    project_get: 'vault_read',
    files_search: 'vault_project_files',
    file_read: 'vault_file',
    project_files_list: 'vault_project_files',
    brand_kit_get: 'vault_brand_kits',
    assets_search: 'vault_assets',
    connected_to: 'vault_connected_to',
    person_open_items: 'vault_person_open_items',
    meeting_items: 'vault_meeting_items',
    project_create: 'neuralvault_project',
    project_set_field: 'neuralvault_project',
    project_set_details: 'neuralvault_project',
    project_add_next_step: 'neuralvault_project',
    project_tick_next_step: 'neuralvault_project',
    project_log_update: 'neuralvault_project',
    project_add_item: 'neuralvault_project',
    project_change_item: 'neuralvault_project',
    project_remove_item: 'neuralvault_project',
    note_create: 'neuralvault_save',
    note_append: 'neuralvault_save',
    note_write: 'neuralvault_save',
    capture: 'neuralvault_save',
    project_save_file: 'neuralvault_attach',
    note_attach_file: 'neuralvault_attach',
  },
  // The side chat's own tools (src/main/agent.ts TOOLS).
  side: {
    vault_overview: 'notes_overview',
    vault_search: 'search_notes',
    note_read: 'read_note',
    notes_list: 'list_notes',
    notes_recent: 'recent_notes',
    files_search: 'search_project_files',
    file_read: 'read_project_file',
    project_files_list: 'list_project_folder',
    assets_search: 'list_assets',
    brand_kit_get: 'brand_kit',
    connected_to: 'connected_to',
    person_open_items: 'person_open_items',
    meeting_items: 'meeting_items',
    project_create: 'save_project',
    project_set_field: 'save_project',
    project_set_details: 'save_project',
    note_create: 'create_note',
    note_append: 'edit_note',
    note_replace: 'edit_note',
    note_write: 'edit_note',
    capture: 'create_note',
    note_move: 'move_note',
    folder_create: 'create_folder',
    note_set_properties: 'set_properties',
    reminder_set: 'set_reminder',
  },
};

/** The former host app's own vault tools with no catalogue entry (yet): each runs in the former host app on the vault's files
 *  with Ironleaf's own rules (vault-kit.mjs, project-file.mjs, layout-writes.mjs), or asks Ironleaf (modules, the vault
 *  check). Listed so the catalogue knows every vault tool any AI has: a test in the former host app
 *  (tests/vault-catalogue.mjs) fails when one of its vault tools is neither served, nor its own for a catalogue tool, nor
 *  here. The side chat and outside agents get the vault-power ones (views, bulk changes, the Bin, records, clips, charts,
 *  imports, receipts) through the former host app itself (sparkDefs: The former host app's main process lists them and
 *  carries them out); the rest are the former host app's alone. */
export const SPARK_ONLY: Record<string, string> = {
  neuralvault_search: 'search the notes and task notes',
  neuralvault_read: 'read a note',
  neuralvault_decision: 'a decision in this conversation’s project',
  neuralvault_doc: 'Docs: how something is set up or run',
  neuralvault_log: 'a dated entry in a project’s log',
  neuralvault_layout: 'a project’s layout and tables',
  neuralvault_module: 'the life modules, asked of Ironleaf',
  vault_check: 'the vault checks and mends itself, asked of Ironleaf',
  neuralvault_view: 'views and dashboards (8.0 V2)',
  neuralvault_bulk: 'safe bulk changes with a preview and one Undo; tags added or taken off (8.0 V3)',
  neuralvault_bin: 'the Bin: what was deleted, and bringing it back (8.0 V4)',
  neuralvault_record: 'a module record added or changed, from a photo or paper too (8.0 V5)',
  neuralvault_clip: 'a web page clipped into the vault (8.0 V13)',
  make_chart: 'a live chart in a note (Phase 5)',
  neuralvault_receipt: 'a receipt filed in Money with its payment row (8.0 F4)',
  neuralvault_import: 'notes brought in from another app\'s export, nothing the person changed overwritten (8.0 V9)',
};

/** The former host app's own vault tools as the former host app's main process lists them (its runtime's vault-served.mjs):
 *  served to the side chat and to outside agents beside the catalogue's own, one handler in the former host app (8.0 V1). */
export interface SparkVaultTool {
  name: string;
  title: string;
  description: string;
  parameters: { type?: string; properties?: Record<string, unknown>; required?: string[] };
  level: AgentLevel;
  readOnly?: boolean;
  /** Deletes something: over MCP it waits for the person, as the catalogue's own deleting tools do. */
  deletes?: boolean;
}
export interface SparkVaultHost {
  tools(): SparkVaultTool[];
  call(who: string, label: string, name: string, args: Record<string, unknown>): Promise<{ text: string; isError?: boolean; changed?: { path: string; before: string | null }[] }>;
}
const SPARK_NAME = /^(?:neuralvault_[a-z_]{2,40}|make_chart)$/;
function sparkDefsFromList(list: SparkVaultTool[]): AgentToolDef[] {
  // First listing wins: a tool listed twice is served once, so a second listing at a lower level never widens who gets it (8.0 V8).
  // A tool with no good level is not served at all: serving it at Full control would widen who gets it (9.2 seam).
  const seen = new Set<string>();
  return list
    .filter((t) => t && SPARK_NAME.test(String(t.name)) && SPARK_ONLY[t.name] && t.parameters && typeof t.parameters === 'object' && (t.level === 'read' || t.level === 'edit' || t.level === 'full') && !VAULT_TOOLS.some((v) => v.name === t.name) && !seen.has(t.name) && (seen.add(t.name), true))
    .map((t) => ({ name: t.name, title: String(t.title || t.name).slice(0, 80), level: t.level, description: String(t.description ?? '').slice(0, 4000), input: (t.parameters.properties ?? {}) as Record<string, unknown>, ...(Array.isArray(t.parameters.required) && t.parameters.required.length ? { required: t.parameters.required.map(String) } : {}), ...(t.readOnly ? { readOnly: true } : {}), ...(t.deletes ? { deletes: true } : {}) }));
}
const toServed = (t: AgentToolDef): ServedTool => ({ name: t.name, tool: t.name, title: t.title, description: t.description, parameters: { type: 'object', properties: t.input, ...(t.required?.length ? { required: [...t.required] } : {}), additionalProperties: false }, level: t.level, readOnly: !!t.readOnly });
/** The former host app's served tools as catalogue definitions (checked: a name and a schema that is an
object). */
export function sparkDefs(host: SparkVaultHost | null | undefined): AgentToolDef[] {
  let list: SparkVaultTool[] = [];
  try {
    list = host?.tools() ?? [];
  } catch {
    list = [];
  }
  return sparkDefsFromList(list);
}
/** The former host app's served tools as the side chat is offered them. */
export function sparkServed(host: SparkVaultHost | null | undefined): ServedTool[] {
  return sparkDefs(host).map(toServed);
}
/** The former host app's served tools, specs and router from one listing (9.2 seam: specs offered and calls routed
 *  pair, so a tools update mid-answer cannot offer what the router no longer knows). */
export function sparkPaired(host: SparkVaultHost | null | undefined): { defs: AgentToolDef[]; served: ServedTool[] } {
  let list: SparkVaultTool[] = [];
  try {
    list = host?.tools() ?? [];
  } catch {
    list = [];
  }
  const defs = sparkDefsFromList(list);
  return { defs, served: defs.map(toServed) };
}

/** Whether a consumer is served this catalogue tool. A tool that deletes waits for the person over MCP; Ironleaf's own
 *  AIs get deleting with the bin and its restore (8.0 V4), not before. */
export function served(consumer: Consumer, def: Pick<AgentToolDef, 'name' | 'deletes'>): boolean {
  if (consumer === 'mcp') return true;
  if (def.deletes) return false;
  return !OWN[consumer][def.name];
}

/** The name a consumer calls a catalogue tool by: its own tool's, else the catalogue's (the side chat, outside agents) or, in
 *  the former host app, vault_<name> for a look and neuralvault_<name> for a change, the names its bots' permissions read
 *  (native-runtime/plugins/desktop/bots.mjs: vault_* reads, neuralvault_* writes). null: the consumer has no such tool. */
export function nameFor(consumer: Consumer, name: string): string | null {
  if (consumer === 'mcp') return name;
  const own = OWN[consumer][name];
  if (own) return own;
  const def = VAULT_TOOLS.find((t) => t.name === name);
  if (!def || !served(consumer, def)) return null;
  if (consumer === 'side') return name;
  return def.readOnly ? `vault_${name.replace(/^vault_/, '')}` : `neuralvault_${name}`;
}

/** The catalogue tool a consumer's served name stands for (null: not one served to it). */
export function toolOf(consumer: Consumer, served: string): AgentToolDef | null {
  return VAULT_TOOLS.find((t) => nameFor(consumer, t.name) === served && (consumer === 'mcp' || !OWN[consumer as OwnConsumer][t.name])) ?? null;
}

// The waits outside agents are told about; Ironleaf's own AIs are talking with the person, so nothing waits.
const WAITS = [/\s*\((?:more than 10 in one call )?waits? for the person to allow it\)/gi, /\s*(?:Removing )?[Ww]aits for the person to allow it\./g];
const NAMES = VAULT_TOOLS.map((t) => t.name).sort((a, b) => b.length - a.length);
const NAME_RE = new RegExp(`\\b(${NAMES.join('|')})\\b`, 'g');

/** Words in a consumer's terms: every tool they name called by the name that consumer knows it by. */
export function wordsFor(consumer: Consumer, text: string): string {
  if (consumer === 'mcp') return text;
  let out = String(text ?? '');
  for (const re of WAITS) out = out.replace(re, '');
  return out.replace(NAME_RE, (whole: string, name: string) => nameFor(consumer, name) ?? whole);
}

const deepWords = (consumer: Consumer, v: unknown): unknown => {
  if (Array.isArray(v)) return v.map((x) => deepWords(consumer, x));
  if (!v || typeof v !== 'object') return v;
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, k === 'description' && typeof x === 'string' ? wordsFor(consumer, x) : deepWords(consumer, x)]));
};

/** The former host app's family for a tool it is served: the everyday ones (what's on, tasks, where a file is, a reminder,
 *  moving and tidying notes, putting a project away) with its other vault tools in "neuralvault", which a chat bot
 *  carries from its first step; the rest (templates, canvases, assets, the brand kit, reviews, the timeline…) in
 *  "neuralvault_more". */
const SPARK_EVERYDAY = new Set(['today_get', 'tasks_list', 'files_find', 'reminder_set', 'note_move', 'note_set_properties', 'project_archive']);

/** The catalogue tools the side chat is offered every round (5 Nov 2026, s10-assistant-tools-lean: every turn sent the
 *  whole catalogue, ~71,000 chars with its own tools; now the daily bread stays and the rest opens with one more_tools
 *  door). Daily bread plus everything the system prompt already teaches by name (the project line tools, templates,
 *  files_find, note_to_pdf); authoring and structural tools (canvases, assets, the brand kit files, templates of its
 *  own, automations, the tidy, the review, files delivered into projects) and the former host app's served tools stay
 *  behind the door, as does every catalogue tool added later (rare by default, so the everyday list never grows
 *  silently). */
export const SIDE_EVERYDAY: ReadonlySet<string> = new Set([
  'projects_list', 'project_get', 'today_get', 'timeline_get', 'meetings_list', 'meeting_actions', 'reviews_list',
  'templates_list', 'template_apply', 'project_add_next_step', 'project_tick_next_step', 'project_log_update',
  'project_add_item', 'project_change_item', 'note_to_pdf', 'design_document', 'daily_note', 'project_move_item', 'project_archive',
  'project_pin_file', 'files_find', 'tasks_list', 'calendar_get',
  // Skills (24 Nov 2026): the list is in the system words; loading one, its files and saving the person's own.
  'skills_list', 'skill_use', 'skill_file', 'skill_save',
  // New Office files straight from what the assistant writes (24 Nov 2026, src/main/office-make.ts).
  'office_make',
]);

/** A catalogue tool as a consumer is offered it. */
export interface ServedTool {
  /** The consumer's name for it. */
  name: string;
  /** The catalogue's name (what dispatch carries out). */
  tool: string;
  title: string;
  description: string;
  /** JSON Schema of its arguments. */
  parameters: { type: 'object'; properties: Record<string, unknown>; required?: string[]; additionalProperties: false };
  level: AgentLevel;
  readOnly: boolean;
  /** The former host app's family for it. */
  family?: 'neuralvault' | 'neuralvault_more';
}

/** Every catalogue tool served to a consumer (those it has no tool of its own for), in the catalogue's order. */
export function catalogueFor(consumer: Consumer): ServedTool[] {
  return VAULT_TOOLS.filter((t) => served(consumer, t)).map((t) => ({
    name: nameFor(consumer, t.name)!,
    tool: t.name,
    title: t.title,
    description: wordsFor(consumer, t.description),
    parameters: { type: 'object', properties: deepWords(consumer, t.input) as Record<string, unknown>, ...(t.required?.length ? { required: [...t.required] } : {}), additionalProperties: false },
    level: t.level,
    readOnly: !!t.readOnly,
    ...(consumer === 'spark' ? { family: SPARK_EVERYDAY.has(t.name) ? ('neuralvault' as const) : ('neuralvault_more' as const) } : {}),
  }));
}

/** Who may call a served tool, as Ironleaf's gate names Ironleaf's own AIs: The former host app, a chat bot, one of its
 *  bots, an outside agent's job run by the former host app, or the side chat. */
export const OWN_ASKER = /^(neuralspark|neuralbot|bot:[\w-]{1,80}|agent:[\w:.-]{1,120}|assistant)$/;

// ── One search, one read, one change card (2 Nov 2026, seams O3/O4/O6/O7) ──
// The shared rules the former host app's own vault tools run on, so the same request gets the same answer whichever
// door it comes through. This file is embedded as vault-tools.mjs (tools/build-embedded.mjs): what is re-exported
// here is what the former host app imports, never a second copy. Each rule is used on this side too (the test names
// where).
export { SEARCH_LIMIT, SEARCH_MAX, PART_CHARS, partOf, noSearchMatchWords } from './agent-access';
export { parseQuery, QueryMatcher } from './query';
export { changeWords, describeChangedList } from './search-ask-87';

const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');
const shortName = (v: string): string => (v.split('/').pop() ?? v).replace(/\.md$/i, '');

/** A served view, chart or dashboard call's thing, by the tool's name (seams O6). */
const SERVED_THING: Record<string, { one: string; many: string }> = {
  neuralvault_view: { one: 'view', many: 'views' },
  make_chart: { one: 'chart', many: 'charts' },
};
/** A served call's action as a verb (seams O6: "Made a view", never the bare listing title). */
const ACTION_VERB: Record<string, 'made' | 'changed' | 'removed' | 'looked'> = {
  create: 'made',
  make: 'made',
  add: 'made',
  update: 'changed',
  change: 'changed',
  edit: 'changed',
  set: 'changed',
  delete: 'removed',
  remove: 'removed',
  list: 'looked',
  get: 'looked',
  show: 'looked',
  read: 'looked',
};

/** One catalogue call's step in per-action words (9.2 seam, seams O6): what was looked at or done, and for whom —
 *  never a bare title. Views, charts and dashboards step by their action ("Made a view"), as the former host app
 *  steps them; reads lead with "Looked at"; writes keep their verb. No "in Ironleaf" tail: each side's own steps
 *  never stamp where they ran. Unknown tools and actions keep the title words. */
export function servedStepWords(served: Pick<ServedTool, 'title' | 'readOnly'> & { name?: string }, args: Record<string, unknown>): string {
  const title = text(served.title, 80).trim() || 'the vault';
  const lower = title.charAt(0).toLowerCase() + title.slice(1);
  const project = text(args.project, 80).trim();
  const shortProject = project ? shortName(project) : '';
  const query = text(args.query, 60).trim();
  const named = text(args.path ?? args.note ?? args.folder ?? args.canvas ?? args.template, 80).trim();
  const shortNamed = named ? (named.split('/').pop() ?? named) : '';
  // Views, charts and dashboards, by what the call did.
  const thing = served.name ? SERVED_THING[served.name] : undefined;
  if (thing) {
    const action = text(args.action, 20).trim().toLowerCase();
    // A chart tool called with no action makes (that is all it does); a view call without one keeps its title words.
    const verb = ACTION_VERB[action] ?? (served.name === 'make_chart' && !action ? 'made' : undefined);
    if (verb) {
      const called = text(args.name ?? args.title ?? args.view, 60).trim();
      const quoted = called ? ` “${called}”` : '';
      const note = served.name === 'make_chart' && named ? ` in ${shortName(named)}` : '';
      const where = shortProject ? ` for ${shortProject}` : '';
      if (verb === 'made') return `Made a ${thing.one}${quoted}${note}${where}`;
      if (verb === 'changed') return `Changed ${called ? 'the' : 'a'} ${thing.one}${quoted}${note}${where}`;
      if (verb === 'removed') return `Removed ${called ? 'the' : 'a'} ${thing.one}${quoted}${note}${where}`;
      if (action === 'list' && !called) return `Looked at the ${thing.many}${where}`;
      return `Looked at ${called ? 'the' : 'a'} ${thing.one}${quoted}${note}${where}`;
    }
  }
  if (served.readOnly) {
    if (query && shortProject) return `Looked at ${lower} for “${query}” in ${shortProject}`;
    if (query) return `Looked at ${lower} for “${query}”`;
    if (shortProject) return `Looked at ${lower} for ${shortProject}`;
    if (shortNamed) return `Looked at ${shortNamed}`;
    return `Looked at ${lower}`;
  }
  if (shortProject) return `${title} for ${shortProject}`;
  if (shortNamed) return `${title} ${shortNamed}`;
  return title;
}
