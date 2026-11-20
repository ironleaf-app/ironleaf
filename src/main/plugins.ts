// Plugins, a first small door (8.9): the plugins folder in the vault's own settings folder (.neuralvault/plugins/),
// each plugin a folder with a manifest (plugin.json) and one script (plugin.js). The script runs here, in the main
// process, inside a vm sandbox with only the plugin API (docs/PLUGINS.md): list and read notes, write notes with
// Undo, a toast, one palette command, one Home card. No require, no files, no network; Secrets and Private notes are
// refused before a script's code sees them. Off until the person switches each one on; each asked for when first
// loaded, with what it wants (and asked again when what is in its folder changes); a crash in a plugin never taking
// the app down (every call in guarded, logged, and answered in words). Kept in Ironleaf's own data (plugins.json:
// what is on and allowed), never in the notes.

import { createHash, randomBytes } from 'node:crypto';
import { promises as fsp, readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { isProjectText } from '../shared/project-file';
import { isPrivatePath } from '../shared/private';
import { ID_DIR } from '../shared/vault-home';
import {
  PLUGIN_ID,
  PLUGIN_MANIFEST,
  PLUGIN_SCRIPT,
  PLUGINS_DIR,
  parsePluginManifest,
  type PluginCardView,
  type PluginCommandView,
  type PluginManifest,
  type PluginPermission,
  type PluginToast,
  type PluginView,
} from '../shared/plugins';
import { EXAMPLE_PLUGIN_FOLDER, EXAMPLE_PLUGIN_MANIFEST, EXAMPLE_PLUGIN_SCRIPT } from './plugin-example';

/** What the plugin layer needs from Ironleaf (src/main/app.ts gives it; the tests give a fixture vault). */
export interface PluginHost {
  dataDir: string;
  /** The vault open now (its .neuralvault/plugins/ is read); null while none is. */
  vaultRoot(): string | null;
  /** Every note's path (Private notes filtered here as well). */
  listNotes(): Promise<string[]>;
  readNote(rel: string): Promise<string>;
  writeNote(rel: string, text: string): Promise<void>;
  existsNote(rel: string): Promise<boolean>;
  /** Throws (in the licence's words) when notes can't be changed. */
  canWrite(): Promise<void>;
  /** A removed plugin's folder, moved to the Bin (never deleted for good). */
  trashPath(abs: string): Promise<void>;
  /** The window told (plugins:changed, plugins:toast). */
  send(channel: string, payload: unknown): void;
  log(message: string): void;
  /** A script's synchronous run at most this long (default 5 s); every handler at most callTimeoutMs (default 15 s). */
  scriptTimeoutMs?: number;
  callTimeoutMs?: number;
}

interface Allowed {
  permissions: PluginPermission[];
  /** sha256 of the manifest and script as allowed: a changed plugin asks again. */
  hash: string;
  at: number;
}

interface Runtime {
  manifest: PluginManifest;
  folder: string;
  hash: string;
  command?: { id: string; title: string; run(): Promise<void> };
  card?: { run(): Promise<{ title?: unknown; lines?: unknown }> };
}

const words = (e: unknown): string => (e instanceof Error ? e.message : String(e)).slice(0, 500);
const titleOf = (rel: string): string => (rel.split('/').pop() ?? rel).replace(/\.md$/i, '');

export class PluginManager {
  private root: string | null = null;
  private state: Record<string, { on: boolean; allowed: Allowed | null }> = {};
  private runtime = new Map<string, Runtime>();
  private startErrors = new Map<string, string>();
  private undos = new Map<string, { pluginId: string; pluginName: string; path: string; before: string; after: string }>();
  private saving: Promise<void> = Promise.resolve();

  constructor(private readonly host: PluginHost) {}

  private get stateFile(): string {
    return path.join(this.host.dataDir, 'plugins.json');
  }

  private say(m: string): void {
    try {
      this.host.log(m);
    } catch {
      // Logging never breaks a plugin's caller.
    }
  }

  private sendChanged(): void {
    try {
      this.host.send('plugins:changed', null);
    } catch {
      // The window reads it on its own next.
    }
  }

  private toast(t: PluginToast): void {
    try {
      this.host.send('plugins:toast', t);
    } catch {
      // The window missed it.
    }
  }

  /** Reads what is on and allowed from Ironleaf's data (a missing file is a fresh start). */
  load(): void {
    try {
      const v = JSON.parse(readFileSync(this.stateFile, 'utf8')) as { plugins?: Record<string, { on?: unknown; allowed?: unknown }> };
      const next: PluginManager['state'] = {};
      for (const [id, s] of Object.entries(v.plugins ?? {}).slice(0, 200)) {
        if (!PLUGIN_ID.test(id) || !s || typeof s !== 'object') continue;
        const a = (s as { allowed?: unknown }).allowed as { permissions?: unknown; hash?: unknown; at?: unknown } | null | undefined;
        const permissions = Array.isArray(a?.permissions) ? a!.permissions.filter((p): p is PluginPermission => p === 'read-notes' || p === 'write-notes') : [];
        next[id] = {
          on: (s as { on?: unknown }).on === true,
          allowed: a && typeof a === 'object' && typeof a.hash === 'string' && /^[0-9a-f]{64}$/.test(a.hash) ? { permissions, hash: a.hash, at: typeof a.at === 'number' ? a.at : 0 } : null,
        };
      }
      this.state = next;
    } catch {
      // None kept yet: everything off, nothing allowed.
    }
  }

  /** The plugins folder now (null while no vault is open). */
  dir(): string | null {
    const root = this.host.vaultRoot();
    return root ? path.join(root, ID_DIR, PLUGINS_DIR) : null;
  }

  /** Saving finished (the tests wait for it). */
  flush(): Promise<void> {
    return this.saving;
  }

  private save(): void {
    const file = this.stateFile;
    const data = { plugins: this.state };
    this.saving = this.saving
      .then(async () => {
        await fsp.mkdir(path.dirname(file), { recursive: true });
        const tmp = `${file}.${process.pid}.tmp`;
        await fsp.writeFile(tmp, JSON.stringify(data), 'utf8');
        await fsp.rename(tmp, file);
      })
      .catch((e: unknown) => this.say(`Plugins: could not save (${words(e)})`));
  }

  private withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
    let t: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, rej) => {
      t = setTimeout(() => rej(new Error(`${what} took too long (over ${Math.round(ms / 1000)} seconds).`)), ms);
      t.unref?.();
    });
    const watched = p.then(
      (v) => (clearTimeout(t), v),
      (e: unknown) => {
        clearTimeout(t);
        throw e;
      },
    );
    return Promise.race([watched, timeout]);
  }

  // ── Reading what is there ─────────────────────────────────────────────────────────────────────────────────────────

  private sha(manifestText: string, scriptText: string): string {
    return createHash('sha256').update(`${manifestText}\n${scriptText}`, 'utf8').digest('hex');
  }

  private async readText(p: string): Promise<string | null> {
    try {
      return await fsp.readFile(p, 'utf8');
    } catch {
      return null;
    }
  }

  /** Every plugin in the folder, with why it cannot run when it cannot. What went away stops running; a plugin whose
   *  folder changed since it was allowed goes off until it is allowed again. */
  async scan(): Promise<PluginView[]> {
    const dir = this.dir();
    const out: PluginView[] = [];
    const live = new Map<string, string>();
    let changed = false;
    if (dir) {
      let entries: string[] = [];
      try {
        entries = (await fsp.readdir(dir, { withFileTypes: true })).filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name).sort();
      } catch {
        // No folder yet: no plugins.
      }
      for (const folder of entries.slice(0, 200)) {
        const broken = (id: string, name: string, manifest: PluginManifest | null, error: string): PluginView => ({
          folder, id, name, version: manifest?.version ?? '', description: manifest?.description ?? '', permissions: manifest?.permissions ?? [], on: false, allowed: false, hasCommand: !!manifest?.command, hasCard: !!manifest?.card, error,
        });
        const manifestText = await this.readText(path.join(dir, folder, PLUGIN_MANIFEST));
        if (manifestText === null) {
          out.push(broken(folder, folder, null, 'It needs its manifest (plugin.json).'));
          continue;
        }
        let parsed: unknown = null;
        try {
          parsed = JSON.parse(manifestText);
        } catch {
          out.push(broken(folder, folder, null, 'Its manifest (plugin.json) is not JSON.'));
          continue;
        }
        const m = parsePluginManifest(parsed);
        if (!m.ok) {
          out.push(broken(folder, folder, null, m.error));
          continue;
        }
        const manifest = m.manifest;
        const scriptText = await this.readText(path.join(dir, folder, PLUGIN_SCRIPT));
        if (scriptText === null) {
          out.push(broken(manifest.id, manifest.name, manifest, 'It needs its script (plugin.js).'));
          continue;
        }
        if (live.has(manifest.id)) {
          out.push(broken(manifest.id, manifest.name, manifest, `Another plugin already uses the id “${manifest.id}”.`));
          continue;
        }
        const hash = this.sha(manifestText, scriptText);
        live.set(manifest.id, hash);
        const st = this.state[manifest.id] ?? { on: false, allowed: null };
        const allowed = !!st.allowed && st.allowed.hash === hash;
        let on = st.on === true;
        if (on && !allowed) {
          on = false;
          this.state[manifest.id] = { on, allowed: st.allowed };
          changed = true;
        }
        const started = this.startErrors.get(manifest.id);
        out.push({ folder, id: manifest.id, name: manifest.name, version: manifest.version, description: manifest.description, permissions: manifest.permissions, on, allowed, hasCommand: !!manifest.command, hasCard: !!manifest.card, ...(started ? { error: started } : {}) });
      }
    }
    for (const [id, r] of [...this.runtime]) {
      const v = out.find((x) => x.id === id && !x.error);
      if (!v || !v.on || !v.allowed || r.hash !== live.get(id)) this.runtime.delete(id);
    }
    if (changed) {
      this.save();
      this.sendChanged();
    }
    return out;
  }

  /** What Settings lists. */
  list(): Promise<PluginView[]> {
    return this.scan();
  }

  // ── The vault ─────────────────────────────────────────────────────────────────────────────────────────────────────

  /** The example plugin, written once: when the plugins folder is first made (never again, so removing it sticks).
   *  Never into a read-only vault (canWrite refused): the example waits until it can be. */
  async ensureExample(): Promise<void> {
    const dir = this.dir();
    if (!dir) return;
    try {
      await this.host.canWrite();
    } catch {
      return;
    }
    try {
      await fsp.stat(dir);
      return;
    } catch {
      // Not there: made with the example in it.
    }
    try {
      const folder = path.join(dir, EXAMPLE_PLUGIN_FOLDER);
      await fsp.mkdir(folder, { recursive: true });
      await fsp.writeFile(path.join(folder, PLUGIN_MANIFEST), EXAMPLE_PLUGIN_MANIFEST, 'utf8');
      await fsp.writeFile(path.join(folder, PLUGIN_SCRIPT), EXAMPLE_PLUGIN_SCRIPT, 'utf8');
    } catch (e) {
      this.say(`Plugins: the example could not be written (${words(e)})`);
    }
  }

  /** The example present the first time the person opens Plugins in any vault (8.9 round 3, 31 Oct 2026, the
   *  reviewer: "no plugin shows"): written into the vault's plugins folder then, even into a folder opened in place
   *  (opening Plugins is the person's own doing, not browsing), never into a read-only vault. Off until allowed. */
  async listWithExample(): Promise<PluginView[]> {
    await this.ensureExample();
    return this.scan();
  }

  /** The vault opened (or switched): the example in place (never into a foreign folder opened in place, and never
   *  while read-only), and what was on started again, each guarded. */
  async useVault(root: string | null, inPlace = false): Promise<void> {
    if (root !== this.root) {
      this.runtime.clear();
      this.startErrors.clear();
      this.root = root;
    }
    if (!root) return;
    if (!inPlace) {
      await this.ensureExample();
    }
    for (const v of await this.scan()) {
      if (!v.on || !v.allowed || v.error) continue;
      try {
        await this.start(v.id);
      } catch (e) {
        this.startErrors.set(v.id, `It couldn’t start: ${words(e)}`);
        this.say(`Plugin ${v.name}: couldn’t start (${words(e)})`);
      }
    }
    this.sendChanged();
  }

  // ── On, allowed, removed ──────────────────────────────────────────────────────────────────────────────────────────

  /** Switches a plugin on or off. On starts its script (guarded); a plugin that is not allowed refuses (Settings asks
   *  first, then allows and switches on). */
  async setOn(id: string, on: boolean): Promise<PluginView[]> {
    const views = await this.scan();
    const v = views.find((x) => x.id === id);
    if (!v) throw new Error('That plugin isn’t in the plugins folder.');
    if (v.error) throw new Error(`${v.name}: ${v.error}`);
    if (on && !v.allowed) throw new Error(`Allow ${v.name} first.`);
    this.startErrors.delete(id);
    if (on) {
      try {
        await this.start(id);
      } catch (e) {
        this.startErrors.set(id, `It couldn’t start: ${words(e)}`);
        this.say(`Plugin ${v.name}: couldn’t start (${words(e)})`);
      }
    } else {
      this.runtime.delete(id);
    }
    this.state[id] = { on, allowed: this.state[id]?.allowed ?? null };
    this.save();
    this.sendChanged();
    return this.scan();
  }

  /** Allows a plugin for what is in its folder now (Settings asks the person first, with what it wants). */
  async allow(id: string): Promise<PluginView[]> {
    const dir = this.dir();
    if (!dir) throw new Error('Open a vault first.');
    const views = await this.scan();
    const v = views.find((x) => x.id === id);
    if (!v) throw new Error('That plugin isn’t in the plugins folder.');
    if (v.error) throw new Error(`${v.name}: ${v.error}`);
    const manifestText = (await this.readText(path.join(dir, v.folder, PLUGIN_MANIFEST))) ?? '';
    const scriptText = (await this.readText(path.join(dir, v.folder, PLUGIN_SCRIPT))) ?? '';
    this.state[id] = { on: this.state[id]?.on ?? false, allowed: { permissions: [...v.permissions], hash: this.sha(manifestText, scriptText), at: Date.now() } };
    this.save();
    this.sendChanged();
    return this.scan();
  }

  /** Removes a plugin: stopped, forgotten, its folder moved to the Bin. */
  async remove(id: string): Promise<PluginView[]> {
    const dir = this.dir();
    const views = await this.scan();
    const v = views.find((x) => x.id === id);
    this.runtime.delete(id);
    this.startErrors.delete(id);
    delete this.state[id];
    if (dir && v) {
      try {
        await this.host.trashPath(path.join(dir, v.folder));
      } catch (e) {
        throw new Error(`“${v.name}” couldn’t be moved to the Bin (${words(e)})`);
      }
    }
    for (const [undoId, u] of [...this.undos]) if (u.pluginId === id) this.undos.delete(undoId);
    this.save();
    this.sendChanged();
    return this.scan();
  }

  // ── Running ───────────────────────────────────────────────────────────────────────────────────────────────────────

  /** Starts a scanned plugin's script in the sandbox (throws in words; the caller logs and shows them). */
  private async start(id: string): Promise<void> {
    const dir = this.dir();
    if (!dir) throw new Error('Open a vault first.');
    const v = (await this.scan()).find((x) => x.id === id);
    if (!v || v.error) throw new Error(v?.error ?? 'That plugin isn’t in the plugins folder.');
    const manifestText = (await this.readText(path.join(dir, v.folder, PLUGIN_MANIFEST))) ?? '';
    const scriptText = (await this.readText(path.join(dir, v.folder, PLUGIN_SCRIPT))) ?? '';
    const parsed = parsePluginManifest(JSON.parse(manifestText) as unknown);
    if (!parsed.ok) throw new Error(parsed.error);
    const manifest = parsed.manifest;
    const hash = this.sha(manifestText, scriptText);
    if (!this.state[id]?.allowed || this.state[id].allowed!.hash !== hash) throw new Error(`Allow ${manifest.name} first.`);
    this.runtime.delete(id);
    const box: { command?: Runtime['command']; card?: Runtime['card'] } = {};
    const api = this.apiFor(manifest, box);
    const module = { exports: {} as Record<string, unknown> };
    const ctx = vm.createContext({ module, exports: module.exports, console: this.safeConsole(manifest) });
    try {
      vm.runInContext(scriptText, ctx, { filename: `${id}/${PLUGIN_SCRIPT}`, timeout: this.host.scriptTimeoutMs ?? 5000 });
    } catch (e) {
      throw new Error(startWords(e));
    }
    const activate = (module.exports as { activate?: unknown }).activate;
    if (typeof activate !== 'function') throw new Error('Its script needs activate(api).');
    await this.withTimeout(Promise.resolve().then(() => (activate as (a: unknown) => unknown)(api)), this.host.callTimeoutMs ?? 15000, 'Starting');
    this.runtime.set(id, { manifest, folder: v.folder, hash, ...(box.command ? { command: box.command } : {}), ...(box.card ? { card: box.card } : {}) });
  }

  private safeConsole(manifest: PluginManifest): { log(...a: unknown[]): void; info(...a: unknown[]): void; warn(...a: unknown[]): void; error(...a: unknown[]): void; debug(...a: unknown[]): void } {
    const send = (...a: unknown[]) => this.say(`Plugin ${manifest.name}: ${a.map((x) => String(x)).join(' ').slice(0, 500)}`);
    return { log: send, info: send, warn: send, error: send, debug: send };
  }

  /** The plugin API a script's activate(api) gets (docs/PLUGINS.md). Every method guards and answers in words. */
  private apiFor(manifest: PluginManifest, box: { command?: Runtime['command']; card?: Runtime['card'] }): Record<string, unknown> {
    const need = (p: PluginPermission): void => {
      if (!manifest.permissions.includes(p)) throw new Error(`${manifest.name} needs your permission to ${p === 'read-notes' ? 'read notes' : 'change notes'}.`);
    };
    const cleanRel = (raw: unknown): string => {
      const rel = typeof raw === 'string' ? raw.trim().replace(/\\/g, '/').replace(/^\.\//, '') : '';
      if (!rel) throw new Error('Give the note’s path.');
      if (rel.length > 500 || rel.startsWith('/') || /^[a-zA-Z]:/.test(rel) || rel.split('/').includes('..')) throw new Error('Give a note’s path inside the vault, such as "Meetings/Site walk.md".');
      if (isPrivatePath(rel)) throw new Error('Private notes are never open to plugins.');
      if (/(^|\/)\.neuralvault(\/|$)/i.test(rel)) throw new Error('That is Ironleaf’s own folder.');
      if (!/\.md$/i.test(rel)) throw new Error('Plugins read notes (.md).');
      return rel;
    };
    return {
      listNotes: async (): Promise<string[]> => {
        need('read-notes');
        return (await this.host.listNotes()).filter((p) => !isPrivatePath(p));
      },
      readNote: async (rel: unknown): Promise<string> => {
        need('read-notes');
        return this.host.readNote(cleanRel(rel));
      },
      writeNote: async (rel: unknown, text: unknown): Promise<void> => {
        need('write-notes');
        await this.host.canWrite();
        const r = cleanRel(rel);
        if (!(await this.host.existsNote(r))) throw new Error(`There is no note “${r}”.`);
        const before = await this.host.readNote(r);
        const content = typeof text === 'string' ? text : String(text ?? '');
        if (isProjectText(before) || isProjectText(content)) throw new Error('That is a project’s file: change it on the project’s page in Ironleaf, so the change is kept in its history.');
        await this.host.writeNote(r, content);
        const undo = `pu_${randomBytes(9).toString('base64url')}`;
        this.undos.set(undo, { pluginId: manifest.id, pluginName: manifest.name, path: r, before, after: content });
        while (this.undos.size > 50) this.undos.delete(this.undos.keys().next().value as string);
        this.toast({ words: `${manifest.name} changed ${titleOf(r)}.`, undo });
      },
      toast: (text: unknown): void => {
        const t = typeof text === 'string' ? text.trim().slice(0, 300) : '';
        if (t) this.toast({ words: t });
      },
      addCommand: (def: unknown, fn: unknown): void => {
        const d = (def && typeof def === 'object' ? def : {}) as { id?: unknown; title?: unknown };
        const cid = typeof d.id === 'string' ? d.id.trim() : '';
        const ctitle = typeof d.title === 'string' ? d.title.trim().slice(0, 60) : '';
        if (!PLUGIN_ID.test(cid) || !ctitle) throw new Error('A command is { id, title }.');
        if (typeof fn !== 'function') throw new Error('A command needs its handler.');
        if (box.command && box.command.id !== cid) throw new Error('A plugin adds one command.');
        box.command = { id: cid, title: ctitle, run: fn as () => Promise<void> };
      },
      setCard: (fn: unknown): void => {
        if (typeof fn !== 'function') throw new Error('A card needs its handler.');
        box.card = { run: fn as () => Promise<{ title?: unknown; lines?: unknown }> };
      },
    };
  }

  /** A plugin's palette command run (guarded: a crash is logged and answered in words, never thrown out). */
  async runCommand(pluginId: string, commandId: string): Promise<{ ok: boolean; words: string }> {
    const r = this.runtime.get(pluginId);
    if (!r?.command || r.command.id !== commandId) return { ok: false, words: 'That command isn’t on now.' };
    try {
      await this.withTimeout(Promise.resolve().then(() => r.command!.run()), this.host.callTimeoutMs ?? 15000, 'That command');
      return { ok: true, words: '' };
    } catch (e) {
      this.say(`Plugin ${r.manifest.name}: couldn’t run its command (${words(e)})`);
      return { ok: false, words: `${r.manifest.name} couldn’t run.` };
    }
  }

  /** Every switched-on plugin's Home card now (a crashed card arrives failed, so Home says so). */
  async cards(): Promise<PluginCardView[]> {
    const out: PluginCardView[] = [];
    for (const [id, r] of [...this.runtime]) {
      if (!r.card) continue;
      const title = r.manifest.card?.title ?? r.manifest.name;
      try {
        const c = await this.withTimeout(Promise.resolve().then(() => r.card!.run()), this.host.callTimeoutMs ?? 15000, 'That card');
        // Spread first: a card's array comes from the sandbox's realm, and must not cross it as-is.
        const lines = Array.isArray(c?.lines) ? [...(c.lines as unknown[])].filter((l): l is string => typeof l === 'string' && !!l.trim()).map((l) => l.trim().slice(0, 200)).slice(0, 6) : [];
        out.push({ pluginId: id, pluginName: r.manifest.name, cardId: r.manifest.card?.id ?? 'card', title: typeof c?.title === 'string' && c.title.trim() ? c.title.trim().slice(0, 60) : title, lines, failed: false });
      } catch (e) {
        this.say(`Plugin ${r.manifest.name}: couldn’t draw its card (${words(e)})`);
        out.push({ pluginId: id, pluginName: r.manifest.name, cardId: r.manifest.card?.id ?? 'card', title, lines: [], failed: true });
      }
    }
    return out;
  }

  /** Every switched-on plugin's palette command now. */
  commands(): PluginCommandView[] {
    const out: PluginCommandView[] = [];
    for (const [id, r] of this.runtime) {
      if (r.command) out.push({ pluginId: id, pluginName: r.manifest.name, commandId: r.command.id, title: r.command.title });
    }
    return out;
  }

  /** A plugin's write taken back (from its toast's Undo): only while the note still reads as the plugin left it. */
  async undo(id: unknown): Promise<string> {
    const u = typeof id === 'string' ? this.undos.get(id) : undefined;
    if (!u) return 'There is nothing to undo.';
    this.undos.delete(id as string);
    const now = await this.host.readNote(u.path).catch(() => null);
    if (now === null) return 'That note is gone, so there is nothing to undo.';
    if (now !== u.after) return 'That note changed since, so Undo left it alone.';
    await this.host.writeNote(u.path, u.before);
    return `Undid ${u.pluginName}’s change to ${titleOf(u.path)}.`;
  }
}

/** A script that would not start, in words (a timeout says what took too long). */
function startWords(e: unknown): string {
  const m = words(e);
  return /timed out/i.test(m) ? 'Its script took too long to start.' : m;
}
