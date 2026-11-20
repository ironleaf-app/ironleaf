// Plugins, a first small door (8.9, 31 Oct 2026: the Vault to match what rival notes apps can do). A plugins folder
// in the vault's own settings folder (.neuralvault/plugins/); a plugin is a folder with a manifest (plugin.json:
// its id, name, what it wants) and one script (plugin.js) that can add a command to the palette and a card to Home,
// through a small documented API (docs/PLUGINS.md: read notes, write notes with Undo, show a toast). Off until the
// person switches each one on; each asked for when first loaded, with what it wants; never reaching Secrets or
// Private notes; a crash in a plugin never taking the app down (guarded, logged in src/main/plugins.ts). This file
// is pure: names, the manifest read, and the views. No files, no window.

/** The plugins folder's name inside the vault's settings folder (.neuralvault/plugins/). */
export const PLUGINS_DIR = 'plugins';
export const PLUGIN_MANIFEST = 'plugin.json';
export const PLUGIN_SCRIPT = 'plugin.js';

/** What a plugin can want: reading notes, changing notes. Secrets and Private notes are never on offer. */
export type PluginPermission = 'read-notes' | 'write-notes';
export const PLUGIN_PERMISSIONS: PluginPermission[] = ['read-notes', 'write-notes'];

/** A plugin, command or card id: lowercase, numbers and dashes, 2 to 64. */
export const PLUGIN_ID = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

export interface PluginManifestCommand {
  id: string;
  title: string;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  permissions: PluginPermission[];
  command?: PluginManifestCommand;
  card?: PluginManifestCommand;
}

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** A manifest read (plugin.json's whole text parsed before it arrives here). */
export function parsePluginManifest(raw: unknown): { ok: true; manifest: PluginManifest } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'Its manifest (plugin.json) could not be read.' };
  const r = raw as Record<string, unknown>;
  const id = str(r.id, 64);
  if (!PLUGIN_ID.test(id)) return { ok: false, error: 'Its manifest needs an id: lowercase, numbers and dashes (such as "word-count").' };
  const name = str(r.name, 60);
  if (!name) return { ok: false, error: 'Its manifest needs a name.' };
  const version = str(r.version, 24) || '1.0.0';
  const description = str(r.description, 200);
  if (!description) return { ok: false, error: 'Its manifest needs a one-line description.' };
  if (r.permissions !== undefined && !Array.isArray(r.permissions)) return { ok: false, error: 'Its manifest’s permissions are a list (such as ["read-notes"]).' };
  const permissions: PluginPermission[] = [];
  for (const p of (Array.isArray(r.permissions) ? r.permissions : []).slice(0, 8)) {
    if (typeof p !== 'string' || !(PLUGIN_PERMISSIONS as string[]).includes(p)) return { ok: false, error: `Its manifest wants “${String(p).slice(0, 40)}”, which plugins cannot have (read-notes and write-notes are all there is).` };
    if (!permissions.includes(p as PluginPermission)) permissions.push(p as PluginPermission);
  }
  const part = (v: unknown, what: string): PluginManifestCommand | undefined => {
    if (v === undefined) return undefined;
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(`Its manifest’s ${what} is { id, title }.`);
    const o = v as Record<string, unknown>;
    const pid = str(o.id, 64);
    const title = str(o.title, 60);
    if (!PLUGIN_ID.test(pid) || !title) throw new Error(`Its manifest’s ${what} needs an id and a title.`);
    return { id: pid, title };
  };
  try {
    const command = part(r.command, 'command');
    const card = part(r.card, 'card');
    return { ok: true, manifest: { id, name, version, description, permissions, ...(command ? { command } : {}), ...(card ? { card } : {}) } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** What the person reads when a plugin is asked for: what each permission means, in one line. */
export function pluginPermissionWords(p: PluginPermission): string {
  return p === 'read-notes' ? 'Read your notes (never Private notes or Secrets)' : 'Change your notes (every change with Undo)';
}

/** A plugin as Settings lists it. */
export interface PluginView {
  /** Its folder's name in the plugins folder. */
  folder: string;
  id: string;
  name: string;
  version: string;
  description: string;
  permissions: PluginPermission[];
  /** Switched on in Settings. */
  on: boolean;
  /** Allowed by the person for what is in its folder now (a changed plugin asks again). */
  allowed: boolean;
  /** What it adds once on (from its manifest). */
  hasCommand: boolean;
  hasCard: boolean;
  /** Why it cannot run (a broken manifest, a missing script, another plugin with its id). */
  error?: string;
}

/** A plugin's Home card, as Home draws it: the title, a few plain lines. */
export interface PluginCardView {
  pluginId: string;
  pluginName: string;
  cardId: string;
  title: string;
  lines: string[];
  /** Its card handler crashed: Home says the card could not load. */
  failed: boolean;
}

/** A plugin's palette command. */
export interface PluginCommandView {
  pluginId: string;
  pluginName: string;
  commandId: string;
  title: string;
}

/** Something a plugin wants said: a toast, with Undo while it is a write just made. */
export interface PluginToast {
  words: string;
  undo?: string;
}
