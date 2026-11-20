// Sensitivity levels (Wave 4, 24 Oct 2026; 22 Oct). Every note, file and asset has one of five levels — Open,
// Work-confidential, Personal, Family-private, Health — and every agent (the side chat, the former host app, a chat bot
// and each bot, each outside agent such as Chief) is allowed the levels the person ticks for it in Settings › Privacy and
// secrets. Nothing else changes for a note until it is given a level: a note with none is Open, as every note was before.
// Where a level comes from, first found wins:
//   1. the note's own `sensitivity:` property (a file or asset: its entry in the vault's sensitivity file),
//   2. its note type's default (a Health check-in type set to Health; a module's record type has its module's level,
//      src/shared/module-records.ts, until the person sets another),
//   3. the nearest folder with a default (an area of life: Health/, Family/, Me/),
//   4. Open.
// The vault's sensitivity file (.neuralvault/sensitivity.json) holds the folder and type defaults, the levels of files
// and assets, each agent's access and how Family-private photos are asked for; it travels with the vault, so every PC and
// the former host app (which reads it with this same module, built into its desktop plugin) decide the same. Pure data
// and rules only: no files, no Node. The main side (src/main/sensitivity.ts) and the former host app carry them out at
// the one place each lets an agent into the vault.

import { moduleTypeLevel } from './module-records';
import { recordCandidates } from './file-records';

export type Level = 'open' | 'work' | 'personal' | 'family' | 'health';

export interface LevelInfo {
  id: Level;
  label: string;
  /** A short label for chips ("Work"). */
  short: string;
  words: string;
}

export const LEVELS: LevelInfo[] = [
  { id: 'open', label: 'Open', short: 'Open', words: 'Fine for the assistants you allow to read your vault.' },
  { id: 'work', label: 'Work-confidential', short: 'Work', words: 'Work matters kept inside work: quotes, contracts, staff and vendors.' },
  { id: 'personal', label: 'Personal', short: 'Personal', words: 'Your own life: money, your CV, the house, ID and documents.' },
  { id: 'family', label: 'Family-private', short: 'Family', words: 'Your family: the kids, school, events. Photos need your OK each time they are used.' },
  { id: 'health', label: 'Health', short: 'Health', words: 'Health and fitness: plans, check-ins, GP visits and results.' },
];
export const LEVEL_IDS: Level[] = LEVELS.map((l) => l.id);
export const isLevel = (v: unknown): v is Level => typeof v === 'string' && (LEVEL_IDS as string[]).includes(v);
export const levelInfo = (l: Level): LevelInfo => LEVELS.find((x) => x.id === l) ?? LEVELS[0];
export const levelLabel = (l: Level): string => levelInfo(l).label;

/** A level as people write it ("Work-confidential", "family private", "Health", "work") → its id, else null. */
export function readLevel(v: unknown): Level | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase().replace(/[\s_-]+/g, ' ');
  if (!s) return null;
  if (isLevel(s)) return s;
  if (s === 'work confidential' || s === 'confidential' || s === 'work') return 'work';
  if (s === 'family private' || s === 'family') return 'family';
  if (s === 'private' || s === 'personal') return 'personal';
  if (s === 'public' || s === 'open' || s === 'none') return 'open';
  return null;
}

// ── Who asks ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** An agent's id: 'side-chat', 'neuralbot', 'bot:<its id>', 'agents' (every outside agent without a row of its own) or
 *  'agent:<its id>' (the local MCP server: 'agent:local-mcp'). */
export type AgentId = string;

export interface AgentGroup {
  id: AgentId;
  label: string;
  words: string;
}

export const AGENT_GROUPS: AgentGroup[] = [
  { id: 'side-chat', label: 'The side chat', words: 'Ironleaf’s own assistant, in the chat beside your notes.' },
    { id: 'neuralbot', label: 'Chat bots', words: 'Chat bots, each with its own row once it has one.' },
  { id: 'agents', label: 'Outside agents', words: 'Other AI apps on this PC (Settings › Connect an AI) and any agent without a row of its own.' },
];

/** What each agent may read until the person changes it: Open and Work for all; Personal for the person's own two
 *  assistants; Family-private and Health for none (the person ticks them where they want them). */
export const DEFAULT_ACCESS: Record<string, Level[]> = {
  'side-chat': ['open', 'work', 'personal'],
  neuralspark: ['open', 'work', 'personal'],
  neuralbot: ['open', 'work'],
  agents: ['open', 'work'],
};

/** The row an agent follows when it has none of its own. */
export function parentOf(who: AgentId): AgentId | null {
  if (who.startsWith('bot:')) return 'neuralbot';
  if (who.startsWith('agent:')) return 'agents';
  return null;
}

/** The group an agent is in at the top (side chat, the former host app, a chat bot or Outside agents). */
export function groupOf(who: AgentId): AgentId {
  let id = who;
  for (let p = parentOf(id); p; p = parentOf(id)) id = p;
  return id;
}

export const agentKey = {
  bot: (id: string) => `bot:${id}`,
  outside: (id: string) => `agent:${id}`,
};

// ── The vault's sensitivity file ─────────────────────────────────────────────────────────────────────────────────────

export const SENSITIVITY_FILE = '.neuralvault/sensitivity.json';

/** Family-private photos: asked for each time an agent allowed Family-private wants one, or never given to any agent. */
export type PhotoRule = 'ask' | 'never';

export interface SensitivityStore {
  version: 1;
  /** A folder's default ("Health": 'health'); the nearest folder with one decides for everything inside it. */
  folders: Record<string, Level>;
  /** A note type's default ("health-checkin": 'health'). */
  types: Record<string, Level>;
  /** Files and assets (not notes, which keep theirs as a property): path → level. */
  items: Record<string, Level>;
  /** Each agent's levels, set by the person; one without a row follows its group, then DEFAULT_ACCESS. */
  access: Record<AgentId, Level[]>;
  photos: PhotoRule;
  /** Scanner findings the person said are not secrets (fingerprints only, never what was found). */
  ignored: string[];
  /** When Private notes were sorted into levels (Settings › Privacy and secrets › Private notes). */
  migrated?: { at: string; notes: number };
}

export const emptyStore = (): SensitivityStore => ({ version: 1, folders: {}, types: {}, items: {}, access: {}, photos: 'ask', ignored: [] });

const cleanRel = (p: unknown): string => (typeof p === 'string' ? p.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').trim() : '');

function levelMap(v: unknown, max = 20000): Record<string, Level> {
  const out: Record<string, Level> = {};
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  for (const [k, x] of Object.entries(v as Record<string, unknown>).slice(0, max)) {
    const key = cleanRel(k);
    const level = readLevel(x);
    if (key && !key.split('/').some((s) => s === '..') && level) out[key] = level;
  }
  return out;
}

/** The sensitivity file read leniently: anything it doesn't understand is left out, never an error. */
export function parseSensitivity(raw: unknown): SensitivityStore {
  let v: unknown = raw;
  if (typeof raw === 'string') {
    try {
      v = JSON.parse(raw.replace(/^\uFEFF/, ''));
    } catch {
      v = null;
    }
  }
  const s = emptyStore();
  if (!v || typeof v !== 'object' || Array.isArray(v)) return s;
  const o = v as Record<string, unknown>;
  s.folders = levelMap(o.folders, 2000);
  const types: Record<string, Level> = {};
  for (const [k, x] of Object.entries(o.types && typeof o.types === 'object' && !Array.isArray(o.types) ? (o.types as Record<string, unknown>) : {}).slice(0, 500)) {
    const level = readLevel(x);
    if (k.trim() && level) types[k.trim().toLowerCase()] = level;
  }
  s.types = types;
  s.items = levelMap(o.items);
  if (o.access && typeof o.access === 'object' && !Array.isArray(o.access)) {
    for (const [who, list] of Object.entries(o.access as Record<string, unknown>).slice(0, 500)) {
      if (!who.trim() || !Array.isArray(list)) continue;
      const levels = LEVEL_IDS.filter((l) => list.some((x) => readLevel(x) === l));
      s.access[who.trim()] = levels;
    }
  }
  s.photos = o.photos === 'never' ? 'never' : 'ask';
  s.ignored = Array.isArray(o.ignored) ? [...new Set(o.ignored.filter((x): x is string => typeof x === 'string' && /^[a-f0-9]{8,64}$/.test(x)))].slice(0, 5000) : [];
  if (o.migrated && typeof o.migrated === 'object') {
    const m = o.migrated as Record<string, unknown>;
    if (typeof m.at === 'string') s.migrated = { at: m.at.slice(0, 40), notes: Number(m.notes) || 0 };
  }
  return s;
}

/** The file's words: keys in a steady order, so two PCs writing the same thing write the same bytes. */
export function writeSensitivity(s: SensitivityStore): string {
  const sorted = <T>(o: Record<string, T>) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
  return `${JSON.stringify({ version: 1, folders: sorted(s.folders), types: sorted(s.types), items: sorted(s.items), access: sorted(s.access), photos: s.photos, ignored: [...s.ignored].sort(), ...(s.migrated ? { migrated: s.migrated } : {}) }, null, 1)}\n`;
}

// ── A note's or file's level ─────────────────────────────────────────────────────────────────────────────────────────

/** The front-matter block, tolerantly (9.2): a BOM or blank lines before it, a trailing comment on a line, and
 *  `[[…]]` values all still read. */
function frontBlock(text: string | null | undefined): string | null {
  const m = /^(?:\uFEFF)?(?:[ \t]*\r?\n)*---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(String(text ?? ''));
  return m ? m[1] : null;
}
const frontClean = (v: string) => v.trim().replace(/\s+#.*$/, '').replace(/^["']|["']$/g, '').replace(/^\[\[(.*)\]\]$/, '$1').trim();

/** The `sensitivity:` property at the top of a note's words (a plain reader: no YAML library, so the former host app can use
it). */
export function frontLevel(text: string | null | undefined): Level | null {
  const block = frontBlock(text);
  if (!block) return null;
  const line = /^sensitivity:[ \t]*(.*)$/im.exec(block);
  return line ? readLevel(frontClean(line[1])) : null;
}

/** A plain property from the top of a note's words (`type`, `area`), lower case; '' when it has none. */
export function frontValue(text: string | null | undefined, key: string): string {
  const block = frontBlock(text);
  const line = block ? new RegExp(`^${key}:[ \\t]*(.*)$`, 'im').exec(block) : null;
  return line ? frontClean(line[1]).toLowerCase() : '';
}
export const frontType = (text: string | null | undefined) => frontValue(text, 'type');

export type LevelFrom = 'note' | 'file' | 'type' | 'folder' | 'none';

export interface LevelOf {
  level: Level;
  from: LevelFrom;
  /** The folder whose default decided it. */
  folder?: string;
}

/** The nearest folder default above a path, if any. */
export function folderLevel(store: SensitivityStore, rel: string): { level: Level; folder: string } | null {
  const parts = cleanRel(rel).split('/');
  const low = Object.fromEntries(Object.entries(store.folders).map(([k, v]) => [k.toLowerCase(), { level: v, folder: k }]));
  // The path itself counts (9.2): the level of folder “Health” is Health, not Open.
  for (let i = parts.length; i >= 1; i--) {
    const hit = low[parts.slice(0, i).join('/').toLowerCase()];
    if (hit) return hit;
  }
  return null;
}

/**
 * A note's or file's level. `own` is what the note itself says (its `sensitivity:` property, read by the caller from its
 * properties or with frontLevel); `type` its note type. A file that isn't a note passes neither.
 */
export function levelOf(store: SensitivityStore, rel: string, own?: unknown, type?: unknown, area?: unknown): LevelOf {
  const mine = readLevel(own);
  if (mine) return { level: mine, from: 'note' };
  const path = cleanRel(rel);
  const item = store.items[path] ?? Object.entries(store.items).find(([k]) => k.toLowerCase() === path.toLowerCase())?.[1];
  if (item) return { level: item, from: 'file' };
  const t = typeof type === 'string' ? type.trim().toLowerCase() : '';
  if (t && store.types[t]) return { level: store.types[t], from: 'type' };
  // A module's record type has its module's level until the person sets another (src/shared/module-records.ts: a Bill
  // is Personal, whether Finance is on or off).
  const byModule = t ? moduleTypeLevel(t) : undefined;
  if (byModule) return { level: byModule, from: 'type' };
  // A note that says its area of life (`area: Health`, src/shared/areas.ts) follows that area's folder default.
  const a = typeof area === 'string' ? area.trim().replace(/^\[\[|\]\]$/g, '').toLowerCase() : '';
  const byArea = a ? Object.entries(store.folders).find(([k]) => k.toLowerCase() === a) : undefined;
  if (byArea) return { level: byArea[1], from: 'folder', folder: byArea[0] };
  const f = folderLevel(store, path);
  if (f) return { level: f.level, from: 'folder', folder: f.folder };
  return { level: 'open', from: 'none' };
}

/**
 * A file's level when it is kept with a record (in the record's Files folder, src/shared/file-records.ts): as private as
 * the record it belongs to, so a family album's photos are Family-private and a quote's PDF Work-confidential, whatever
 * folder they sit in, unless the file has a level of its own. `propsOf` gives a note's properties (undefined: no such
 * note). A note, or a file kept with nothing, has its own level as levelOf says.
 */
export function fileLevelOf(store: SensitivityStore, rel: string, propsOf: (rel: string) => Record<string, unknown> | undefined): LevelOf {
  const mine = levelOf(store, rel);
  if (mine.from === 'file' || /\.md$/i.test(rel)) return mine;
  for (const record of recordCandidates(rel)) {
    const p = propsOf(record);
    if (!p) continue;
    const theirs = levelOf(store, record, p.sensitivity, p.type, p.area);
    return theirs.from === 'none' ? mine : theirs;
  }
  return mine;
}

// ── Who may read what ────────────────────────────────────────────────────────────────────────────────────────────────

/** The levels an agent may read (its own row, else its group's, else the default; Open is always among them).
 *  Note (9.2): an own row replaces its group's row, so Settings must show the effective set when it saves one;
 *  merging here instead would also merge away a person's deliberate restriction, which is worse. */
export function accessOf(store: SensitivityStore, who: AgentId): Level[] {
  let id: AgentId | null = who;
  while (id) {
    const set = store.access[id];
    if (set) return set.includes('open') ? set : ['open', ...set];
    id = parentOf(id);
  }
  return DEFAULT_ACCESS[groupOf(who)] ?? ['open'];
}

/** Whether the agent has a row of its own (else it follows its group). */
export const hasOwnRow = (store: SensitivityStore, who: AgentId) => !!store.access[who];

export const allows = (store: SensitivityStore, who: AgentId, level: Level): boolean => accessOf(store, who).includes(level);

const PICTURE = /\.(png|jpe?g|gif|webp|bmp|avif|tiff?|heic|heif|svg|mp4|mov|m4v|mkv|webm|avi|wmv)$/i;
/** A photo or video (Family-private ones are asked for each time). */
export const isPicture = (rel: string) => PICTURE.test(rel);

export type Decision = { ok: true; level: Level } | { ok: false; level: Level; consent: boolean; why: string };

/** Whether an agent may have a note or file of that level: refused in words an agent can pass on, or waiting for the
 *  person's OK (a Family-private photo when the agent is allowed Family-private and photos are asked for). */
export function decide(store: SensitivityStore, who: AgentId, rel: string, level: Level, agentName = 'This agent'): Decision {
  if (!allows(store, who, level)) return { ok: false, level, consent: false, why: refusal(level, agentName) };
  if (level === 'family' && isPicture(rel)) {
    if (store.photos === 'never') return { ok: false, level, consent: false, why: `Family-private photos are never given to agents (Ironleaf › Settings › Privacy and secrets).` };
    return { ok: false, level, consent: true, why: `That is a Family-private photo: the person allows each use. A request is waiting for them in Ironleaf; ask again once they have allowed it.` };
  }
  return { ok: true, level };
}

// 26 Oct 2026: refused a Family-private publication with no way forward, the assistant worked around it and handed over an
// earlier test's PDF as today's paper. The refusal says the way forward: the person's switch, and to stop until then.
export const refusal = (level: Level, agentName = 'This agent') =>
  `That is marked ${levelLabel(level)} and ${agentName} isn’t allowed ${levelLabel(level)} items (the person sets this in Ironleaf › Settings › Privacy and secrets). Don’t guess at what it says. If the person asked for this, stop and tell them in one line: allowing ${agentName} ${levelLabel(level)} there lets it go ahead. Never work around it with other files or other tools.`;

// ── Locked links to Secrets ──────────────────────────────────────────────────────────────────────────────────────────

/** A link to a secret in a note: "[locked](secret:k3J9…)"; the words are a label, never the secret. */
export const SECRET_LINK = /\[([^\]\n]{0,80})\]\(secret:([A-Za-z0-9_-]{6,40})\)/g;
export const secretLink = (id: string, label = 'locked') => {
  if (!/^[A-Za-z0-9_-]{6,40}$/.test(id)) throw new Error('That secret link is not valid.');
  return `[${label.replace(/[[\]\n]/g, ' ').trim() || 'locked'}](secret:${id})`;
};
export function secretIdsIn(text: string): string[] {
  // A fresh matcher each call (9.2): the exported /g regex is stateful under .test elsewhere.
  return [...new Set([...String(text ?? '').matchAll(/\[([^\]\n]{0,80})\]\(secret:([A-Za-z0-9_-]{6,40})\)/g)].map((m) => m[2]))];
}

/** What every agent is told about locked links. */
export const LOCKED_WORDS = 'A link like [locked](secret:…) in a note stands for a password, passcode or key kept in the person’s locked Secrets. Agents can never read it: say it is locked and that the person can copy it from Ironleaf.';

// ── The audit trail ──────────────────────────────────────────────────────────────────────────────────────────────────

export type AuditAction = 'read' | 'listed' | 'changed' | 'refused' | 'asked' | 'allowed-once' | 'revealed' | 'copied' | 'secret-added' | 'secret-changed' | 'secret-removed' | 'level-set' | 'access-set' | 'moved-to-secrets' | 'exported';

export interface AuditEntry {
  at: number;
  /** Who: 'you', or an agent id. */
  who: string;
  whoName: string;
  action: AuditAction;
  /** A note's or file's path, or a secret's name ("Secret: Wexley St iPad passcode"). Never a secret's value. */
  item: string;
  level?: Level;
  /** More in words ("search for “blood tests”", "Open → Health"). */
  detail?: string;
  /** The PC it happened on. */
  pc?: string;
}

export const AUDIT_FOLDER = '.neuralvault/audit';

/** One line of an audit file (JSON Lines), checked; null when it isn't one. */
export function readAuditLine(line: string): AuditEntry | null {
  let v: unknown;
  try {
    v = JSON.parse(line);
  } catch {
    return null;
  }
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.at !== 'number' || typeof o.who !== 'string' || typeof o.action !== 'string' || typeof o.item !== 'string') return null;
  return {
    at: o.at,
    who: o.who.slice(0, 200),
    whoName: typeof o.whoName === 'string' ? o.whoName.slice(0, 120) : o.who.slice(0, 120),
    action: o.action as AuditAction,
    item: o.item.slice(0, 600),
    ...(isLevel(o.level) ? { level: o.level } : {}),
    ...(typeof o.detail === 'string' ? { detail: o.detail.slice(0, 400) } : {}),
    ...(typeof o.pc === 'string' ? { pc: o.pc.slice(0, 80) } : {}),
  };
}

export const auditLine = (e: AuditEntry) => `${JSON.stringify(e)}\n`;

/** The audit file one PC writes this month ("2026-10 OFFICE-PC.jsonl"), so two PCs never write the same file. */
export function auditFileName(at: number, pc: string): string {
  const d = new Date(at);
  const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const name = String(pc || 'this-pc').replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 40) || 'this-pc';
  return `${month} ${name}.jsonl`;
}

export const ACTION_WORDS: Record<AuditAction, string> = {
  read: 'Read',
  listed: 'Saw in results',
  changed: 'Changed',
  refused: 'Refused',
  asked: 'Asked to use',
  'allowed-once': 'Allowed once',
  revealed: 'Revealed',
  copied: 'Copied',
  'secret-added': 'Added a secret',
  'secret-changed': 'Changed a secret',
  'secret-removed': 'Removed a secret',
  'level-set': 'Set the level',
  'access-set': 'Changed access',
  'moved-to-secrets': 'Moved into Secrets',
  exported: 'Exported the trail',
};

/** The trail as CSV (for Export): when, who, what, item, level, detail, PC. */
export function auditCsv(entries: AuditEntry[]): string {
  // \r quotes too, and a cell starting = + - @ is never a spreadsheet formula (9.2).
  const cell = (v: string) => {
    const safe = /^[=+\-@]/.test(v) ? `'${v}` : v;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const rows = entries.map((e) => [new Date(e.at).toISOString(), e.whoName, ACTION_WORDS[e.action] ?? e.action, e.item, e.level ? levelLabel(e.level) : '', e.detail ?? '', e.pc ?? ''].map(cell).join(','));
  return `When,Who,What,Item,Level,Detail,PC\n${rows.join('\n')}${rows.length ? '\n' : ''}`;
}
