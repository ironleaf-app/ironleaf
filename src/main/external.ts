// Ironleaf from outside its window (21 Oct 2026, gap G26): the ironleaf command (src/main/cli.ts), ironleaf://
// links (src/shared/uri.ts) and Markdown files from anywhere on the PC (src/main/loose-files.ts), with their places in
// Windows (src/main/windows-entry.ts). The app gives it what it needs; this module keeps the rules:
//
//   - a link that would change the notes always asks first ("Make a note from a link?"), unless the person allowed that
//     kind of link without asking (Settings › Files and links › Links from other apps; kept in links.json in Ironleaf's
//     own data). Opening a note and searching never ask, and never change anything;
//   - the command is the person's own doing at their own terminal, so it runs at once (and File recovery keeps every
//     note's earlier version);
//   - both use the same verbs agents use, as the person, and never reach Private notes.

import { dialog, type BrowserWindow } from 'electron';
import { promises as fsp, readFileSync } from 'node:fs';
import path from 'node:path';
import { CliServer, runCliArgs, type CliHost } from './cli';
import { LooseFiles, type LooseFile, type LooseOpened } from './loose-files';
import { handleMcpLine, type LocalMcpBackend, type McpPrompt, type McpPromptGot, type McpResource } from './mcp-local';
import { registerWindows, type WindowsEntryResult } from './windows-entry';
import type { McpTool } from '../shared/agent-access';
import { cleanAllowList, confirmWords, launchTargets, needsConfirm, parseVaultUri, URI_WRITES, type UriAction } from '../shared/uri';

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

export interface ExternalHost {
  dataDir: string;
  kind: 'standalone' | 'embedded';
  version: string;
  /** Ironleaf's .ico, for its places in Windows. */
  icon: string;
  /** Registers a handler only Ironleaf's own window may call. */
  handle(channel: string, fn: (...args: any[]) => unknown): void;
  send(channel: string, payload: unknown): void;
  window(): BrowserWindow | null;
  openWindow(target?: { note?: string; line?: number; place?: string; folder?: string; newNote?: boolean }): Promise<void>;
  /** This window at one of its Settings sections (deep landing for settings links), on its row when named. */
  openSettingsAt?(section: string, row?: string): Promise<void>;
  /** The notes opened when they aren't yet. */
  ready(): Promise<void>;
  vaultRoot(): string | null;
  /** The verbs agents use, as the person (src/main/agent-access.ts). */
  agents: { asPerson(name: string, args: Record<string, unknown>): Promise<ToolResult>; personNote(raw: string, write?: boolean): string; localMcpTools(): McpTool[]; asLocalMcp(name: unknown, args: unknown): Promise<ToolResult>; localMcpResources?(): McpResource[]; readLocalMcpResource?(uri: string): Promise<{ uri: string; mimeType: string; text: string }>; localMcpPrompts?(): McpPrompt[]; localMcpPrompt?(name: string, args: Record<string, unknown>): { description: string; messages: McpPromptGot['messages'] } };
  readNote(rel: string): Promise<string>;
  writeNote(rel: string, text: string): Promise<void>;
  canWrite(): Promise<void>;
  dailyNote(): Promise<string>;
  /** A free note name in a folder ("Idea 2.md" when "Idea.md" is there). */
  freeNote(folder: string, title: string): Promise<string>;
  notes(): Iterable<{ path: string; content: string }>;
  /** Where Windows should start Ironleaf from, and whether to write Ironleaf's places in Windows this start. */
  windowsEntry?: { exe: string; launchArgs: string[] } | null;
  /** Asks before a link changes the notes (a test gives its own answer). */
  ask?(words: { title: string; message: string; detail: string; ok: string }, always: string): Promise<{ ok: boolean; always: boolean }>;
  log?(message: string): void;
}

/** Something for the window to do (it takes them with external:take, so none is missed while it is still loading). */
export type ExternalItem = { kind: 'search'; query: string } | { kind: 'loose'; file: LooseFile } | { kind: 'toast'; words: string };

export interface ExternalState {
  allow: ('new' | 'append' | 'daily')[];
  /** Where the ironleaf command is (null: not set up on this PC). */
  cli: string | null;
  /** Links and "Open with" are registered for this Windows user. */
  registered: boolean;
  /** The command's folder was just added to the PATH: a terminal opened before now doesn't know it yet. */
  pathAdded: boolean;
  windows: boolean;
}

const text = (r: ToolResult) => r.content.map((c) => c.text).join('\n');

export class ExternalEntry {
  readonly loose: LooseFiles;
  private readonly server: CliServer;
  private items: ExternalItem[] = [];
  private allow: ('new' | 'append' | 'daily')[] = [];
  private registered: WindowsEntryResult | null = null;
  private readonly linksFile: string;

  constructor(private readonly host: ExternalHost) {
    this.loose = new LooseFiles(() => host.vaultRoot());
    this.linksFile = path.join(host.dataDir, 'links.json');
    try {
      this.allow = cleanAllowList((JSON.parse(readFileSync(this.linksFile, 'utf8')) as { allow?: unknown }).allow);
    } catch {
      // None kept yet: every link that changes notes asks.
    }
    this.server = new CliServer({ file: path.join(host.dataDir, 'cli.json'), version: host.version, run: (argv, stdin) => this.runCommand(argv, stdin), mcp: (line) => this.runMcp(line), log: host.log });
  }

  // ── The command ──

  /** The command's way into the notes. */
  cliHost(): CliHost {
    const h = this.host;
    return {
      version: () => h.version,
      tool: async (name, args) => {
        await h.ready();
        const r = await h.agents.asPerson(name, args);
        return { text: text(r), ...(r.isError ? { isError: true } : {}) };
      },
      note: (raw, write) => h.agents.personNote(raw, write),
      open: (rel) => h.openWindow({ note: rel }),
      read: (rel) => h.readNote(rel),
      write: (rel, t) => h.writeNote(rel, t),
      canWrite: () => h.canWrite(),
      dailyNote: () => h.dailyNote(),
      notes: () => h.notes(),
    };
  }

  async runCommand(argv: string[], stdin: string) {
    await this.host.ready().catch(() => {});
    return runCliArgs(argv, stdin, this.cliHost());
  }

  /** One MCP message line from another AI app on this PC ("ironleaf mcp"): answered through the same dispatch
   *  agents use, with the person's switch and Read only / Read and write honoured (src/main/agent-access.ts). */
  async runMcp(line: string): Promise<string | null> {
    return handleMcpLine(this.mcpBackend(), line);
  }

  /** The app's MCP backend: the stdio bridge (/mcp on the command's connection) and the local URL both answer with it. */
  mcpBackend(): LocalMcpBackend {
    const h = this.host;
    return {
      version: () => h.version,
      tools: () => h.agents.localMcpTools(),
      call: async (name, args) => {
        await h.ready().catch(() => {});
        const r = await h.agents.asLocalMcp(name, args);
        return { text: text(r), ...(r.isError ? { isError: true } : {}) };
      },
      ...(h.agents.localMcpResources && h.agents.readLocalMcpResource
        ? {
            resources: async () => {
              await h.ready().catch(() => {});
              return h.agents.localMcpResources!();
            },
            readResource: async (uri: string) => {
              await h.ready().catch(() => {});
              return h.agents.readLocalMcpResource!(uri);
            },
          }
        : {}),
      ...(h.agents.localMcpPrompts && h.agents.localMcpPrompt
        ? {
            prompts: async () => {
              await h.ready().catch(() => {});
              return h.agents.localMcpPrompts!();
            },
            prompt: async (name: string, args: Record<string, unknown>) => {
              await h.ready().catch(() => {});
              return h.agents.localMcpPrompt!(name, args);
            },
          }
        : {}),
    };
  }

  // ── Links ──

  /** One ironleaf:// link: done, asked about first, or refused in words (which the window shows). */
  async link(raw: string): Promise<{ done: boolean; words: string }> {
    const parsed = parseVaultUri(raw);
    if (!parsed.ok) return this.say(false, parsed.error);
    const a = parsed.action;
    try {
      await this.host.ready();
      if (a.kind === 'open') {
        if (!a.note.trim() && !a.place && !a.folder && !a.newNote && !a.settings) {
          await this.host.openWindow();
          return { done: true, words: 'Opened Ironleaf.' };
        }
        if (a.note.trim()) {
          const rel = this.host.agents.personNote(a.note);
          await this.host.openWindow({ note: rel });
          return { done: true, words: `Opened ${rel}.` };
        }
        // Deep landing (16 Nov 2026, apps-together part 3): the exact page, not just the app.
        if (a.settings) {
          if (this.host.openSettingsAt) await this.host.openSettingsAt(a.settings, a.row);
          else await this.host.openWindow();
          return { done: true, words: 'Opened Ironleaf’s settings.' };
        }
        await this.host.openWindow({ ...(a.place ? { place: a.place } : {}), ...(a.folder ? { folder: a.folder } : {}), ...(a.newNote ? { newNote: true } : {}) });
        return { done: true, words: 'Opened Ironleaf.' };
      }
      if (a.kind === 'search') {
        await this.host.openWindow();
        this.push({ kind: 'search', query: a.query });
        return { done: true, words: `Searched for ${a.query}.` };
      }
      await this.host.canWrite();
      const where = await this.target(a);
      if (needsConfirm(a, this.allow)) {
        await this.host.openWindow();
        const label = URI_WRITES.find((w) => w.kind === a.kind)!.label.toLowerCase();
        const answer = await (this.host.ask ?? this.askWithDialog)(confirmWords(a, where), `Don’t ask again for links that ${label}`);
        if (!answer.ok) return this.say(false, 'Nothing was changed: the link was cancelled.');
        if (answer.always) await this.setAllow([...this.allow, a.kind as 'new' | 'append' | 'daily']);
      }
      const r = await this.write(a, where);
      if (!r.ok) return this.say(false, r.words);
      await this.host.openWindow({ note: r.rel });
      return this.say(true, r.words);
    } catch (err) {
      return this.say(false, err instanceof Error ? err.message : String(err));
    }
  }

  /** The note a writing link would change (or make). */
  private async target(a: UriAction): Promise<string> {
    if (a.kind === 'new') return this.host.freeNote(a.folder, a.name || 'Untitled');
    if (a.kind === 'append') return this.host.agents.personNote(a.note, true);
    return this.host.dailyNote();
  }

  private async write(a: UriAction, rel: string): Promise<{ ok: boolean; words: string; rel: string }> {
    const run = async (name: string, args: Record<string, unknown>) => this.host.agents.asPerson(name, args);
    if (a.kind === 'new') {
      const r = await run('note_create', { path: rel, content: a.text });
      return { ok: !r.isError, words: r.isError ? text(r) : `Made ${rel} from a link.`, rel };
    }
    if (a.kind === 'append' || a.kind === 'daily') {
      const r = await run('note_append', { path: rel, text: a.text, ...(a.heading ? { heading: a.heading } : {}) });
      return { ok: !r.isError, words: r.isError ? text(r) : `Added to ${rel} from a link.`, rel };
    }
    return { ok: false, words: 'That link doesn’t change notes.', rel };
  }

  private askWithDialog = async (words: { title: string; message: string; detail: string; ok: string }, always: string): Promise<{ ok: boolean; always: boolean }> => {
    const win = this.host.window();
    const options = { type: 'question' as const, title: words.title, message: words.message, detail: words.detail, buttons: [words.ok, 'Cancel'], defaultId: 1, cancelId: 1, noLink: true, checkboxLabel: always, checkboxChecked: false };
    const r = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options);
    return { ok: r.response === 0, always: r.response === 0 && r.checkboxChecked };
  };

  private say(done: boolean, words: string): { done: boolean; words: string } {
    this.push({ kind: 'toast', words });
    return { done, words };
  }

  /** Also the tray's Search (src/main/tray.ts): the window opens Search with nothing typed. */
  push(item: ExternalItem): void {
    this.items.push(item);
    if (this.items.length > 50) this.items.shift();
    this.host.send('external:items', null);
  }

  async setAllow(kinds: unknown): Promise<ExternalState> {
    this.allow = cleanAllowList(kinds);
    await fsp.mkdir(this.host.dataDir, { recursive: true });
    await fsp.writeFile(this.linksFile, JSON.stringify({ allow: this.allow }, null, 2));
    return this.state();
  }

  // ── Files from outside the vault ──

  /** A Markdown file from anywhere: a note in the vault opens as itself; any other opens in a tab of its own. */
  /** A file from outside the vault: from outside the window (a start, "Open with", a second start) it is brought to the
   *  window and handed over as an item; asked for by the window itself (its tab opening the file again after a
   *  restart, File › Open, a drop) it is only opened and returned, the window showing it as it does — 22 Nov 2026: a
   *  tab's own re-open handed the file back as a new item, which opened another tab, which opened it again, without end. */
  async openFile(abs: unknown, from: 'outside' | 'window' = 'outside'): Promise<LooseOpened> {
    await this.host.ready().catch(() => {});
    const r = await this.loose.open(abs);
    if (from === 'window') return r;
    if (r.kind === 'vault') await this.host.openWindow({ note: r.rel });
    else {
      await this.host.openWindow();
      this.push({ kind: 'loose', file: r.file });
    }
    return r;
  }

  /** What a start (or a second start while Ironleaf runs) asks for: links and files, each in turn. */
  async launch(argv: readonly unknown[]): Promise<void> {
    const { links, files } = launchTargets(argv);
    for (const f of files) await this.openFile(f).catch((err) => this.say(false, err instanceof Error ? err.message : String(err)));
    for (const l of links) await this.link(l);
  }

  // ── The window, Settings and Windows ──

  state(): ExternalState {
    return { allow: [...this.allow], cli: this.registered?.cli ?? null, registered: !!this.registered && !this.registered.problems.some((p) => p.startsWith('HKCU')), pathAdded: this.registered?.pathAdded ?? false, windows: process.platform === 'win32' };
  }

  register(): void {
    const h = this.host;
    h.handle('external:take', () => this.items.splice(0));
    h.handle('external:state', () => this.state());
    h.handle('external:allow', (kinds: unknown) => this.setAllow(kinds));
    h.handle('loose:open', (abs: unknown) => this.openFile(abs, 'window'));
    h.handle('loose:pick', async () => {
      const win = h.window();
      const options = { title: 'Open a Markdown file', buttonLabel: 'Open', properties: ['openFile' as const, 'multiSelections' as const], filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd', 'txt'] }] };
      const r = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
      const out: LooseOpened[] = [];
      for (const f of r.canceled ? [] : r.filePaths) out.push(await this.openFile(f, 'window'));
      return out;
    });
    h.handle('loose:read', (id: unknown) => this.loose.read(id));
    h.handle('loose:write', (id: unknown, t: unknown, base: unknown) => this.loose.write(id, t, typeof base === 'number' || base === null ? base : undefined));
    h.handle('loose:close', (id: unknown) => this.loose.close(id));
    // A copy in the vault (the file outside stays as it is): at the top of the notes, under a free name.
    h.handle('loose:copy-in', async (id: unknown) => {
      const f = this.loose.get(id);
      await h.canWrite();
      const { text: words } = await this.loose.read(id);
      const rel = await h.freeNote('', f.name.replace(/\.(md|markdown|mdown|mkd|txt)$/i, ''));
      await h.writeNote(rel, words);
      return rel;
    });
  }

  /** The command's connection (always), and the places in Windows when this copy should have them. */
  async start(): Promise<void> {
    try {
      await this.server.start();
    } catch (err) {
      this.host.log?.(`The ironleaf command can’t reach Ironleaf: ${err instanceof Error ? err.message : String(err)}`);
    }
    const we = this.host.windowsEntry;
    if (process.platform === 'win32' && we) {
      this.registered = await registerWindows({ exe: we.exe, launchArgs: we.launchArgs, dataDir: this.host.dataDir, endpointFile: path.join(this.host.dataDir, 'cli.json'), icon: this.host.icon });
      if (this.registered.problems.length) this.host.log?.(`Ironleaf’s places in Windows: ${this.registered.problems.join('; ')}`);
    }
  }

  async stop(): Promise<void> {
    await this.server.stop();
  }
}
