// The ironleaf command, Ironleaf's side (21 Oct 2026, gap G26). The command (a small script the installed app
// registers, src/main/windows-entry.ts) sends its words to the Ironleaf running on this PC over a local connection
// only this Windows user can use: 127.0.0.1, on a port and with a secret written to a file in Ironleaf's own data
// (cli.json), never in the notes. Here its words are read (src/shared/cli.ts) and run with the same verbs agents use
// (src/main/agent-access.ts asPerson): the same note finding, the same writes, File recovery keeping every version, and
// Private notes never reached. It is the person's own doing, so nothing waits for approval and nothing is logged as an
// agent's.

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { changeProps } from '../shared/frontmatter';
import { cliHelp, parseCli, propertyValue, tasksIn, type CliCommand } from '../shared/cli';
import { isPrivatePath } from '../shared/private';

export interface CliResult {
  /** 0 done, 1 it couldn't be done, 2 the command was written wrongly. */
  exit: 0 | 1 | 2;
  text: string;
}

/** What the command may do, given by the app. */
export interface CliHost {
  version(): string;
  /** The verbs agents use, run as the person (AgentAccess.asPerson). */
  tool(name: string, args: Record<string, unknown>): Promise<{ text: string; isError?: boolean }>;
  /** A note that is there, by its title or path, found as agents find it (never a Private note); `write` also refuses a
   *  project's file, which changes on its page. Throws in words when there is none. */
  note(raw: string, write?: boolean): string;
  /** The window opened at a note. */
  open(rel: string): Promise<void>;
  read(rel: string): Promise<string>;
  write(rel: string, text: string): Promise<void>;
  /** Throws (in the licence's words) when notes can't be changed. */
  canWrite(): Promise<void>;
  /** Today's note, made when it isn't there yet; its path. */
  dailyNote(): Promise<string>;
  /** Every note's path and words (for tasks). */
  notes(): Iterable<{ path: string; content: string }>;
}

/** Words written for agents, said for a person at a terminal. */
export function forPersonAtTerminal(text: string): string {
  return text
    .replace(/Find its path with vault_search or notes_list\./g, 'Look for it with: ironleaf search <words>')
    .replace(/Read it and use note_append, or choose another name\./g, 'Add to it with ironleaf append, or choose another name.')
    .replace(/Private notes are never open to agents\./g, 'Private notes are never reached from the command line or links.')
    .replace(/Agents change notes \(\.md\) only\./g, 'Only notes (.md) are changed this way.')
    .replace(/That is a project’s file: use the project tools[^.]*\./g, 'That is a project’s file: change it on the project’s page in Ironleaf, so the change is kept in its history.')
    .replace(/That is a project file: start projects with project_create\./g, 'That is a project file: start projects in Ironleaf (New project).')
    .replace(/Read it with note_read[^.]*\./g, '')
    .replace(/\(note_read[^)]*\)/g, '')
    .trim();
}

const ok = (text: string): CliResult => ({ exit: 0, text });
const failed = (text: string): CliResult => ({ exit: 1, text: forPersonAtTerminal(text) });

async function viaTool(host: CliHost, name: string, args: Record<string, unknown>): Promise<CliResult> {
  const r = await host.tool(name, args);
  return r.isError ? failed(r.text) : ok(forPersonAtTerminal(r.text));
}

/** One command run. */
export async function runCli(command: CliCommand, host: CliHost): Promise<CliResult> {
  try {
    switch (command.verb) {
      case 'help':
        return ok(cliHelp(command.about));
      case 'version':
        return ok(`Ironleaf ${host.version()}`);
      case 'open': {
        const rel = host.note(command.note);
        await host.open(rel);
        return ok(`Opened ${rel} in Ironleaf.`);
      }
      case 'read': {
        const rel = host.note(command.note);
        return ok(await host.read(rel));
      }
      case 'search':
        return await viaTool(host, 'vault_search', { query: command.query, limit: command.limit });
      case 'create': {
        const r = await host.tool('note_create', { path: command.path, content: command.text });
        if (r.isError) return failed(r.text);
        const made = /^Made (.+)\.$/.exec(r.text)?.[1];
        if (command.open && made) await host.open(made);
        return ok(made ? `Made ${made}.` : forPersonAtTerminal(r.text));
      }
      case 'append':
        return await viaTool(host, 'note_append', { path: command.note, text: command.text, ...(command.heading ? { heading: command.heading } : {}) });
      case 'daily:append': {
        await host.canWrite();
        const rel = await host.dailyNote();
        return await viaTool(host, 'note_append', { path: rel, text: command.text, ...(command.heading ? { heading: command.heading } : {}) });
      }
      case 'property:set': {
        const rel = host.note(command.note, true);
        await host.canWrite();
        const before = await host.read(rel);
        const value = propertyValue(command.value, command.list);
        const after = changeProps(before, (doc) => {
          if (value === null) doc.delete(command.name);
          else doc.set(command.name, value);
        });
        if (after === before) return ok(`${rel} already had that.`);
        await host.write(rel, after);
        return ok(value === null ? `Took ${command.name} away from ${rel}.` : `Set ${command.name} in ${rel}.`);
      }
      case 'mcp':
        // Reached only by an old command script (the new one bridges stdio itself): said plainly, not an error.
        return ok('Your notes’ MCP server runs from your other AI apps’ set-up, not by hand. Switch it on in Ironleaf (Settings › Connect an AI), then paste the set-up for your app.');
      case 'tasks': {
        const only = command.note ? host.note(command.note) : null;
        const rows: string[] = [];
        let count = 0;
        for (const n of host.notes()) {
          if (isPrivatePath(n.path) || (only && n.path !== only)) continue;
          for (const t of tasksIn(n.path, n.content)) {
            if (command.show === 'open' ? t.done : command.show === 'done' ? !t.done : false) continue;
            count++;
            if (rows.length < command.limit) rows.push(`${t.done ? '[x]' : '[ ]'} ${t.text}  (${t.path}:${t.line})`);
          }
        }
        const what = command.show === 'done' ? 'done' : command.show === 'all' ? '' : 'open';
        if (!count) return ok(`No ${what ? `${what} ` : ''}tasks${only ? ` in ${only}` : ''}.`);
        return ok(`${rows.join('\n')}${count > rows.length ? `\n… and ${count - rows.length} more (use --limit).` : ''}`);
      }
    }
  } catch (err) {
    return failed(err instanceof Error ? err.message : String(err));
  }
}

/** The command's words read, then run. */
export async function runCliArgs(argv: readonly string[], stdin: string, host: CliHost): Promise<CliResult> {
  const parsed = parseCli(argv, stdin);
  if (!parsed.ok) return { exit: 2, text: parsed.error };
  return runCli(parsed.command, host);
}

// ── The local connection ──────────────────────────────────────────────────────────────────────────────────────────

/** What cli.json holds: where the running Ironleaf listens and the secret the command proves itself with. */
export interface CliEndpoint {
  port: number;
  token: string;
  pid: number;
  version: string;
}

const BODY_MAX = 1024 * 1024;

/** The connection the command talks to: on 127.0.0.1 only, each request carrying the secret from cli.json (a web page can
 *  read neither, and one that guesses the port is refused by its Host and its missing secret). /cli answers one
 *  command; /mcp answers one MCP message line (the "ironleaf mcp" bridge posts each stdin line here). */
export class CliServer {
  private server: http.Server | null = null;
  private endpoint: CliEndpoint | null = null;

  constructor(private readonly opts: { file: string; version: string; run(argv: string[], stdin: string): Promise<CliResult>; mcp?(line: string): Promise<string | null>; log?(message: string): void }) {}

  get port(): number | null {
    return this.endpoint?.port ?? null;
  }

  async start(): Promise<CliEndpoint> {
    if (this.endpoint) return this.endpoint;
    const token = randomBytes(24).toString('base64url');
    const server = http.createServer((req, res) => void this.answer(req, res, token));
    server.on('clientError', (_err, socket) => socket.destroy());
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });
    server.unref();
    const port = (server.address() as AddressInfo).port;
    this.server = server;
    this.endpoint = { port, token, pid: process.pid, version: this.opts.version };
    const tmp = `${this.opts.file}.${randomBytes(4).toString('hex')}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(this.endpoint), { mode: 0o600 });
    await fsp.rename(tmp, this.opts.file);
    return this.endpoint;
  }

  private async answer(req: http.IncomingMessage, res: http.ServerResponse, token: string): Promise<void> {
    const send = (status: number, body: CliResult) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    const port = this.endpoint?.port;
    const host = String(req.headers.host ?? '');
    const given = String(req.headers['x-neuralvault-cli'] ?? '');
    // A browser's request carries an Origin (and is refused); the command never sends one.
    if (req.method !== 'POST' || (req.url !== '/cli' && req.url !== '/mcp') || req.headers.origin !== undefined || (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) || !sameSecret(given, token)) {
      return send(403, { exit: 1, text: 'Refused.' });
    }
    if (req.url === '/mcp') return this.answerMcp(req, res);
    let size = 0;
    const chunks: Buffer[] = [];
    try {
      for await (const chunk of req) {
        size += (chunk as Buffer).length;
        if (size > BODY_MAX) return send(413, { exit: 1, text: 'That is too much for one command.' });
        chunks.push(chunk as Buffer);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { args?: unknown; stdin?: unknown };
      const argv = Array.isArray(body.args) ? body.args.filter((a): a is string => typeof a === 'string').slice(0, 64) : [];
      const stdin = typeof body.stdin === 'string' ? body.stdin : '';
      send(200, await this.opts.run(argv, stdin));
    } catch (err) {
      this.opts.log?.(`ironleaf command: ${err instanceof Error ? err.message : String(err)}`);
      send(400, { exit: 1, text: 'Ironleaf couldn’t read that command.' });
    }
  }

  /** One MCP message line answered: the answer line (a notification gets 204, nothing back). */
  private async answerMcp(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const line = (status: number, text: string) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(text);
    };
    let size = 0;
    const chunks: Buffer[] = [];
    try {
      for await (const chunk of req) {
        size += (chunk as Buffer).length;
        if (size > BODY_MAX) return line(200, JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'That message is too long.' } }));
        chunks.push(chunk as Buffer);
      }
      const body = Buffer.concat(chunks).toString('utf8');
      if (!this.opts.mcp) {
        let id: string | number | null = null;
        try {
          const m = JSON.parse(body) as { id?: unknown };
          if (!Array.isArray(m) && (typeof m.id === 'string' || typeof m.id === 'number')) id = m.id;
        } catch {
          // No id to answer to.
        }
        return line(200, JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32603, message: 'Ironleaf is not serving its MCP server.' } }));
      }
      const out = await this.opts.mcp(body);
      if (out === null) {
        res.writeHead(204, { 'cache-control': 'no-store' });
        res.end();
        return;
      }
      return line(200, out);
    } catch (err) {
      this.opts.log?.(`ironleaf mcp: ${err instanceof Error ? err.message : String(err)}`);
      return line(200, JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32603, message: 'Ironleaf couldn’t answer that message.' } }));
    }
  }

  async stop(): Promise<void> {
    const ep = this.endpoint;
    this.endpoint = null;
    this.server?.close();
    this.server = null;
    if (!ep) return;
    // Taken away only while it is still this Ironleaf's (a newer one may have written its own).
    try {
      const now = JSON.parse(await fsp.readFile(this.opts.file, 'utf8')) as CliEndpoint;
      if (now.token === ep.token) await fsp.rm(this.opts.file, { force: true });
    } catch {
      // Not there.
    }
  }
}

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
