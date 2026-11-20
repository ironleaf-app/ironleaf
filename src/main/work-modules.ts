// The work modules on the main side (Wave 6 part b, 24 Oct 2026; src/shared/work-modules.ts): Meetings, Weekly Updates,
// Sites and Equipment, and Vendors, Quotes and Contracts. This file is what they share: which are on, where each keeps
// its notes (inside the Work area when the vault has areas), the notes of their types read from the index (the whole
// index for the window, an agent's gated one for its tools), new notes made under a free name, files kept beside a
// record, the vault's options for them (.neuralvault/module-options.json, so every PC shows the same), the bell's
// notices (said once each, src/main/reminders.ts post) and their agent tools through each agent's gate.
//
// Each module's own work is its part (src/main/work/<module>.ts): its window calls ("work:call" with the module and the
// call's name), its notices, its tools and the rules the side chat is told while it is on. Nothing here runs while every
// work module is off: no timer, no file, no notice, no tool.

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { AREAS_FILE, readAreas } from '../shared/areas';
import { filesFolderFor } from '../shared/file-records';
import { MODULE_ALIASES, moduleInfo, modulesOn as switchesOn, partOn, resolveModule, type ModuleSwitches } from '../shared/life-modules';
import { MODULE_OPTIONS_FILE, moduleTypeInputs, readModuleOptions, remindDaysOf, typeFolder, moduleFolder, withModuleOptions, writeModuleOptions, type ModuleOptions, type ModuleOptionsFile } from '../shared/module-records';
import { readTypes, resolveTypes, typeOfNote, type NoteType } from '../shared/note-types';
import type { ProjectEdit } from '../shared/project-file';
import type { RecordModel } from '../shared/records';
import { refusal } from '../shared/sensitivity';
import { safeName } from '../shared/project-file';
import { WORK_MODULES } from '../shared/work-modules';
import { WORK_TOOLS, type WorkToolDef } from '../shared/work-module-tools';
import type { RecordModule } from '../shared/module-records';
import type { ProjectEditResult } from '../shared/types';
import { DOCS_FOLDER } from '../shared/doc-file';
import type { VaultIndex } from './indexer';
import { gateIndex, type Gate } from './agent-gate';
import { readTypesFile } from './note-types';
import type { Vault } from './vault';
import { makeMeetings } from './work/meetings';
import { makeWeekly } from './work/weekly';
import { makeSites } from './work/sites';
import { makeVendors } from './work/vendors';
import { devSwitch } from './dev-switch';

/** A note of a module's type (or a meeting note) as the parts read it. */
export interface WorkNote {
  path: string;
  title: string;
  props: Record<string, unknown>;
  content: string;
  type: string;
  mtime: number;
  links: string[];
}

export interface WorkNotice {
  key: string;
  kind: string;
  title: string;
  body: string;
  path: string;
}

export interface WorkModulesDeps {
  /** A login kept in Secrets, for Systems and Home Lab's Check now (its user name and value; never shown or written). */
  login?(id: string): Promise<{ username: string; value: string }>;
  /** Ironleaf's own data folder on this PC. */
  dataDir?: string;
  vault(): Vault;
  index: VaultIndex;
  prefs(): { templatesFolder: string; modules: ModuleSwitches };
  /** Writes a note as every save does (indexed, file recovery, open tabs told). */
  writeNote(rel: string, text: string): Promise<void>;
  /** Copies files from the PC into a folder of the vault (never over one there), giving their paths. */
  importFiles(paths: string[], folder: string): Promise<string[]>;
  /** The open-file dialog: the files chosen (one unless `many`), or none. */
  pickFiles(options: { title: string; button: string; many?: boolean; filters?: { name: string; extensions: string[] }[] }): Promise<string[]>;
  /** The save dialog for an export (null when cancelled); the file written as given. */
  saveFile(options: { title: string; name: string; ext: string; filter: string; data: Uint8Array | string }): Promise<string | null>;
  /** A notice in the bell (and a Windows notification), said once for its key (Reminders.post). */
  post(items: WorkNotice[]): number;
  /** A change to a project file through its page's own path (its history, so Undo takes it back). */
  editProject(rel: string, edit: ProjectEdit | ProjectEdit[], by?: string, said?: string): Promise<ProjectEditResult>;
  /** Every project (its file and name). */
  projects(): { path: string; name: string }[];
  /** The connected vault for an index (src/shared/records.ts). */
  records(index?: VaultIndex): RecordModel;
  /** The chat's model asked for JSON (meeting notes from a transcript). */
  askJson?(system: string, user: string): Promise<{ reply: unknown; error?: string }>;
  requireCreate(): Promise<void>;
  log?(message: string): void;
  now?(): Date;
  /** This PC (the move's gate compares the vault's PCs). */
  device?: { id: string; name: string };
  /** This app's version (the move waits until every PC has the new one). */
  appVersion?: string;
  /** Health and Fitness's yes/no habits and the days each was answered yes (Goals and Habits shows them on its streak
   *  calendar), when Health and Fitness is on; none otherwise. */
  healthHabits?(): Promise<{ id: string; name: string; days: string[] }[]>;
  /** Send one email through the former host app's mail (Weekly Updates' send, 8.2): the person is asked first there, as
   *  for every send. Absent in standalone Ironleaf, which has no mail of its own. */
  sendMail?(input: { to: string[]; subject: string; text: string }): Promise<{ ok: boolean; words: string }>;
}

/** What a part is told about the asker of a tool. */
export interface ToolCtx {
  /** The index the asker may read (the whole index for the person). */
  gated: VaultIndex;
  /** The asker's name, for its answers ("a chat bot isn’t allowed…"). */
  agent: string;
  gate?: Gate | null;
  /** Throws the refusal when the asker may not change a note there. */
  check?(rel: string): void;
}

/** One work module's own work (src/main/work/<module>.ts). */
export interface WorkPart {
  id: string;
  /** The window's calls: "work:call" (module, name, args). */
  ops: Record<string, (...args: unknown[]) => unknown>;
  /** The bell's notices now (only called while the module is on). */
  check?(): Promise<WorkNotice[]>;
  /** One of its tools for an asker (only called while the module is on). */
  tool?(name: string, args: Record<string, unknown>, ctx: ToolCtx): Promise<string>;
  /** The side chat's line about it while it is on. */
  rules?(): string;
}

/** A group of modules made of notes that share this machinery: its modules, their tools and each module's own part. The
 *  work modules are one group (the default); another group (Memories and Media, Business… src/main/life-records.ts) is
 *  another WorkModules with its own, every rule here the same. */
export interface ModuleGroup {
  modules: RecordModule[];
  tools: WorkToolDef[];
  parts(w: WorkModules): WorkPart[];
}

export const WORK_GROUP: ModuleGroup = { modules: WORK_MODULES, tools: WORK_TOOLS, parts: (w) => [makeMeetings(w), makeWeekly(w), makeSites(w), makeVendors(w)] };

const CHECK_MS = 10 * 60_000;

export class WorkModules {
  private timer: ReturnType<typeof setInterval> | null = null;
  readonly parts: WorkPart[];
  private typesCache: { key: string; types: NoteType[] } | null = null;

  constructor(
    readonly d: WorkModulesDeps,
    readonly group: ModuleGroup = WORK_GROUP,
  ) {
    this.parts = group.parts(this);
  }

  // ── Switches, places, options ──────────────────────────────────────────────────────────────────────────────────

  today(): Date {
    return this.d.now?.() ?? new Date();
  }
  todayIso(): string {
    const t = this.today();
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  }
  /** Every module switched on (the person's switches, src/shared/life-modules.ts). */
  allOn(): string[] {
    const ids = switchesOn(this.d.prefs().modules).map((m) => m.id);
    // A merged pack's record machinery answers when its pack is on (packs uplift item 5: Memories' albums,
    // tools, checks and types answer when Family is on).
    for (const [from, to] of Object.entries(MODULE_ALIASES)) if (!ids.includes(from) && ids.includes(to)) ids.push(from);
    return ids;
  }
  /** This group's modules switched on. */
  on(): string[] {
    return this.allOn().filter((id) => this.group.modules.some((m) => m.id === id));
  }
  /** Whether a module is one of this group's. */
  has(id: unknown): id is string {
    return typeof id === 'string' && this.group.modules.some((m) => m.id === id);
  }
  isOn(id: string): boolean {
    return this.on().includes(id);
  }
  part(id: string, part: string): boolean {
    return partOn(this.d.prefs().modules, id, part);
  }
  need(id: string): void {
    // A merged pack's machinery names the pack that holds its switch (packs uplift item 5: Memories' machinery
    // says Family, where the switch lives now).
    if (!this.isOn(id)) throw new Error(`${moduleInfo(resolveModule(id))?.name ?? this.group.modules.find((m) => m.id === id)?.name ?? 'That module'} is switched off (Settings › Packs).`);
  }

  async read(rel: string): Promise<string | null> {
    try {
      return await fsp.readFile(path.join(this.d.vault().root, ...rel.split('/')), 'utf8');
    } catch {
      return null;
    }
  }
  async areas(): Promise<{ id: string; folder: string }[] | null> {
    return readAreas(await this.read(AREAS_FILE)).config?.areas ?? null;
  }
  async options(): Promise<ModuleOptionsFile> {
    return readModuleOptions(await this.read(MODULE_OPTIONS_FILE));
  }
  async setOptions(id: string, patch: ModuleOptions): Promise<ModuleOptionsFile> {
    await this.d.requireCreate();
    const next = withModuleOptions(await this.options(), id, patch);
    const file = path.join(this.d.vault().root, ...MODULE_OPTIONS_FILE.split('/'));
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, writeModuleOptions(next), 'utf8');
    return next;
  }
  async remindDays(id: string): Promise<number> {
    return remindDaysOf(await this.options(), id);
  }
  /** One of a module's own settings (Weekly Updates' due day…), else `fallback`. */
  async setting<T extends string | number | boolean>(id: string, key: string, fallback: T): Promise<T> {
    const v = (await this.options())[id]?.settings?.[key];
    return (typeof v === typeof fallback ? v : fallback) as T;
  }
  async folderOf(typeId: string): Promise<string> {
    return typeFolder(typeId, await this.areas());
  }
  async moduleFolder(id: string): Promise<string> {
    return moduleFolder(id, await this.areas());
  }

  private async types(): Promise<NoteType[]> {
    const on = this.allOn();
    const areas = await this.areas();
    const key = `${this.d.index.generation?.() ?? ''}|${on.join(',')}|${JSON.stringify(areas)}`;
    if (this.typesCache?.key === key) return this.typesCache.types;
    const types = resolveTypes(readTypes(await readTypesFile(this.d.vault().root)).config, { topFolders: [], templatesFolder: this.d.prefs().templatesFolder, docsFolder: DOCS_FOLDER, modules: moduleTypeInputs(on, areas) });
    this.typesCache = { key, types };
    return types;
  }

  /** The notes of these types an index has (the whole index, or an agent's gated one). `also` takes in a note of another
   *  type too (a meeting note, whatever its type says). */
  async notesOf(index: VaultIndex, typeIds: readonly string[], also?: (path: string, props: Record<string, unknown>) => boolean): Promise<WorkNote[]> {
    const types = await this.types();
    const templates = (this.d.prefs().templatesFolder || 'Templates').replace(/\/+$/, '');
    const out: WorkNote[] = [];
    for (const m of index.allMeta()) {
      if (!/\.md$/i.test(m.path) || m.path.startsWith(`${templates}/`)) continue;
      const type = typeOfNote(m, types, this.d.prefs().templatesFolder) ?? '';
      if (!typeIds.includes(type) && !also?.(m.path, m.props ?? {})) continue;
      out.push({ path: m.path, title: m.title, props: m.props ?? {}, content: index.content(m.path) ?? '', type, mtime: m.mtime, links: (m.links ?? []).map((l) => index.resolve(l.target, m.path) ?? l.target) });
    }
    return out;
  }

  /** A note's text as the index has it now (throws in words when it has gone). */
  noteText(rel: string): string {
    const t = this.d.index.content(rel);
    if (t === undefined) throw new Error('That note isn’t there any more.');
    return t;
  }

  async freeNote(folder: string, name: string): Promise<string> {
    const v = this.d.vault();
    const base = safeName(name, 100) || 'Untitled';
    for (let i = 1; i < 1000; i++) {
      const rel = `${folder ? `${folder}/` : ''}${i === 1 ? base : `${base} ${i}`}.md`;
      if (!(await v.any(rel))) return rel;
    }
    throw new Error('No free name was found for that note.');
  }
  async newNote(folder: string, name: string, text: string): Promise<string> {
    await this.d.requireCreate();
    const rel = await this.freeNote(folder, name);
    await this.d.writeNote(rel, text);
    return rel;
  }
  /** Writes a note changed by `change` (nothing written when it comes back the same). */
  async change(rel: string, change: (text: string) => string): Promise<boolean> {
    await this.d.requireCreate();
    const before = this.noteText(rel);
    const after = change(before);
    if (after === before) return false;
    await this.d.writeNote(rel, after);
    return true;
  }

  /** A record's files: those in its Files folder (src/shared/file-records.ts), newest first. */
  async filesOf(note: string): Promise<string[]> {
    const dir = filesFolderFor(note);
    try {
      const abs = path.join(this.d.vault().root, ...dir.split('/'));
      const entries = await fsp.readdir(abs, { withFileTypes: true });
      const out: { rel: string; mtime: number }[] = [];
      for (const e of entries) {
        if (!e.isFile() || e.name.startsWith('.')) continue;
        const st = await fsp.stat(path.join(abs, e.name)).catch(() => null);
        out.push({ rel: `${dir}/${e.name}`, mtime: st?.mtimeMs ?? 0 });
      }
      return out.sort((a, b) => b.mtime - a.mtime).map((x) => x.rel);
    } catch {
      return [];
    }
  }
  /** Files from the PC kept with a record (copied into its Files folder). */
  async keepFiles(rel: string, files: string[]): Promise<string[]> {
    await this.d.requireCreate();
    return this.d.importFiles(files.filter((f) => typeof f === 'string' && path.isAbsolute(f)).slice(0, 30), filesFolderFor(rel));
  }
  pickFiles(title: string, filters?: { name: string; extensions: string[] }[]): Promise<string[]> {
    const test = devSwitch('NV_TEST_ATTACH_FILES');
    if (test) return Promise.resolve(test.split(path.delimiter).filter(Boolean));
    return this.d.pickFiles({ title: title || 'Choose files to keep with it', button: 'Keep with it', many: true, ...(filters ? { filters } : {}) });
  }

  // ── Notices ──────────────────────────────────────────────────────────────────────────────────────────────────────

  async check(): Promise<number> {
    const on = this.on();
    if (!on.length) return 0;
    const items: WorkNotice[] = [];
    for (const p of this.parts) {
      if (!on.includes(p.id) || !p.check) continue;
      try {
        items.push(...(await p.check()));
      } catch (e) {
        this.d.log?.(`work modules check (${p.id}): ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return items.length ? this.d.post(items) : 0;
  }
  /** One timed check: a failure is logged, never swallowed (the bell's misses would otherwise vanish). */
  async tick(): Promise<void> {
    try {
      await this.check();
    } catch (e) {
      this.d.log?.(`work modules check: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), CHECK_MS);
    this.timer.unref?.();
    setTimeout(() => void this.tick(), 9000).unref?.();
  }
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  // ── The agents' tools ────────────────────────────────────────────────────────────────────────────────────────────

  toolsOn(): WorkToolDef[] {
    const on = this.on();
    return this.group.tools.filter((t) => on.includes(t.module));
  }

  /** One of the tools for an asker with its gate (none: the person): null when it isn't a work module's. Reads come from
   *  what the gate lets through; a write is refused unless the asker is allowed the module's level, and each note it
   *  changes is checked against the gate before anything is written. */
  async callTool(name: string, args: Record<string, unknown>, gate?: Gate | null): Promise<{ text: string } | null> {
    const def = this.group.tools.find((t) => t.name === name);
    if (!def) return null;
    const mod = this.group.modules.find((m) => m.id === def.module)!;
    if (!this.isOn(mod.id)) return { text: `${moduleInfo(resolveModule(mod.id))?.name ?? mod.name} is switched off in Ironleaf (Settings › Packs). Say so; don’t guess.` };
    if (def.write && gate && !gate.allowsLevel(mod.level)) return { text: refusal(mod.level, gate.name) };
    const part = this.parts.find((p) => p.id === mod.id);
    if (!part?.tool) return { text: `There is no tool called ${name}.` };
    const gated = gate ? gateIndex(this.d.index, gate) : this.d.index;
    try {
      return { text: await part.tool(name, args ?? {}, { gated, agent: gate?.name ?? 'This agent', gate: gate ?? null, check: gate ? (rel) => gate.check(rel, 'changed') : undefined }) };
    } catch (e) {
      return { text: e instanceof Error ? e.message : String(e) };
    }
  }

  rules(): string {
    const on = this.on();
    return this.parts
      .filter((p) => on.includes(p.id) && p.rules)
      .map((p) => p.rules!())
      .filter(Boolean)
      .join(' ');
  }
}

/** The window's way in: "work:call" (module, name, args) to a part's own call, and the shared options, for every group
 *  (the work modules, and any other group made the same way). */
export function registerWorkModules(groups: WorkModules | WorkModules[], handle: (channel: string, fn: (...args: any[]) => unknown) => void): void {
  const all = Array.isArray(groups) ? groups : [groups];
  const groupOf = (module: unknown) => all.find((g) => g.has(module)) ?? null;
  handle('work:call', async (module: unknown, name: unknown, args: unknown) => {
    const w = groupOf(module);
    const part = w?.parts.find((p) => p.id === module);
    if (!w || !part) throw new Error('That module isn’t known.');
    // Meetings is part of the app, not an optional module (Polish round 3, 29 Oct 2026, ITEMS 1): the nav's
    // Meetings page reads the vault's meetings and works on them whether or not the Meetings module is
    // switched on, so its window calls are not refused. Its extras stay with the module: the prep pack
    // (name !== 'prep' is what lets the rest through) and series, which keep the switch. Every other module
    // switched off still refuses, as before; the agent tools below keep their own switch too.
    const meetingsCore = part.id === 'meetings' && typeof name === 'string' && name !== 'prep' && !['add-series', 'next-in-series', 'make-series'].includes(name);
    if (!meetingsCore) w.need(part.id);
    const op = typeof name === 'string' && Object.prototype.hasOwnProperty.call(part.ops, name) ? part.ops[name] : null;
    if (!op) throw new Error('That can’t be done here.');
    return op(...(Array.isArray(args) ? args.slice(0, 8) : []));
  });
  handle('work:options', async (module: unknown, patch: unknown) => {
    const w = groupOf(module);
    if (!w) throw new Error('That module isn’t known.');
    if (patch && typeof patch === 'object') return w.setOptions(module as string, patch as ModuleOptions);
    return w.options();
  });
  handle('work:check', async () => (await Promise.all(all.map((g) => g.check()))).reduce((a, b) => a + b, 0));
}
