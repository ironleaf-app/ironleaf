// The Vault's local MCP server speaking (8.9): JSON-RPC 2.0 over stdio (one message a line, answers on stdout, never a
// log line there), the way Claude Code, Claude Desktop, Cursor and VS Code run it ("ironleaf mcp"). One handler
// (handleMcpLine) answers a message; the stdio loop (McpLocalServer) and the /mcp local-connection endpoint
// (src/main/cli.ts, which the command's bridge posts each line to) both call it. The vault behind it is a backend:
// the app's (AgentAccess.asLocalMcp, the same dispatch agents use) or the tests' fixture. Nothing here reads the
// vault itself.

import type { McpTool } from '../shared/agent-access';

/** A tool call's answer, as MCP's tools/call result carries it. */
export interface LocalMcpCallResult {
  text: string;
  isError?: boolean;
}

/** The vault behind the server: its version, its tools now, and one call carried out (tool failures as isError, with
 *  the switch, the level, Private notes and Undo already honoured). */
export interface LocalMcpBackend {
  version(): string;
  tools(): Promise<McpTool[]> | McpTool[];
  call(name: string, args: Record<string, unknown>): Promise<LocalMcpCallResult>;
  /** The notes as resources (ironleaf://note/<path>), when the backend serves them. */
  resources?(): Promise<McpResource[]> | McpResource[];
  readResource?(uri: string): Promise<{ uri: string; mimeType: string; text: string }>;
}

/** One note as an MCP resource. */
export interface McpResource {
  uri: string;
  name: string;
  title?: string;
  mimeType?: string;
}

/** Said to a client at initialize: what the server is and how to start. */
export const MCP_INSTRUCTIONS =
  'Ironleaf is the person’s library of Markdown notes. Start with vault_overview, find notes with vault_search or meaning_search, read one with note_read, and follow links with note_links. Private notes are never reachable. Every change is listed in Ironleaf (What agents did) with Undo, and File recovery keeps earlier versions.';

/** A line longer than this is dropped with the connection (4 MB: a note's worth and more). */
export const MCP_MAX_LINE = 4 * 1024 * 1024;
/** At most this many messages in one batch. */
const BATCH_MAX = 50;
/** Answered when the client names no protocol version. */
const FALLBACK_VERSION = '2025-06-18';

type Id = string | number | null;
const ok = (id: Id, result: unknown): string => JSON.stringify({ jsonrpc: '2.0', id, result });
const err = (id: Id, code: number, message: string): string => JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } });

const idOf = (m: Record<string, unknown>): Id | undefined => (typeof m.id === 'string' || typeof m.id === 'number' ? m.id : undefined);
const paramsOf = (m: Record<string, unknown>): Record<string, unknown> => (m.params && typeof m.params === 'object' && !Array.isArray(m.params) ? (m.params as Record<string, unknown>) : {});

/** One message answered (null for a notification, or a batch of them: nothing is sent back). Never throws. */
export async function handleMcpLine(backend: LocalMcpBackend, line: string): Promise<string | null> {
  let msg: unknown;
  try {
    msg = JSON.parse(line);
  } catch {
    return err(null, -32700, 'That message could not be read.');
  }
  if (Array.isArray(msg)) {
    if (msg.length > BATCH_MAX) return err(null, -32600, 'Too many messages at once.');
    const out: string[] = [];
    for (const m of msg) {
      const r = await handleOne(backend, m);
      if (r !== null) out.push(r);
    }
    return out.length ? `[${out.join(',')}]` : null;
  }
  return handleOne(backend, msg);
}

async function handleOne(backend: LocalMcpBackend, raw: unknown): Promise<string | null> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return err(null, -32600, 'That is not a JSON-RPC message.');
  const m = raw as Record<string, unknown>;
  const id = idOf(m);
  if (m.jsonrpc !== '2.0' || typeof m.method !== 'string') {
    // A malformed notification is dropped quietly; a malformed request is told so.
    return id === undefined ? null : err(id, -32600, 'That is not a JSON-RPC message.');
  }
  const method = m.method;
  // A notification (no id) is never answered, whatever it asks.
  if (id === undefined) {
    if (method === 'tools/call') await callTool(backend, m).catch(() => null);
    return null;
  }
  try {
    const params = paramsOf(m);
    switch (method) {
      case 'initialize': {
        const asked = typeof params.protocolVersion === 'string' && params.protocolVersion ? params.protocolVersion.slice(0, 40) : FALLBACK_VERSION;
        return ok(id, { protocolVersion: asked, capabilities: { tools: { listChanged: false }, ...(backend.resources ? { resources: { listChanged: false } } : {}) }, serverInfo: { name: 'ironleaf', title: 'Ironleaf', version: String(backend.version() ?? '').slice(0, 40) || '1.0.0' }, instructions: MCP_INSTRUCTIONS });
      }
      case 'tools/list':
        return ok(id, { tools: await backend.tools() });
      case 'tools/call': {
        const r = await callTool(backend, m);
        return ok(id, { content: [{ type: 'text', text: r.text }], ...(r.isError ? { isError: true } : {}) });
      }
      case 'resources/list':
        return ok(id, { resources: backend.resources ? await backend.resources() : [] });
      case 'resources/templates/list':
        return ok(id, { resourceTemplates: backend.resources ? [{ uriTemplate: 'ironleaf://note/{path}', name: 'note', title: 'A note', mimeType: 'text/markdown' }] : [] });
      case 'resources/read': {
        const uri = typeof params.uri === 'string' ? params.uri.slice(0, 2000) : '';
        if (!backend.readResource || !uri) return err(id, -32602, 'Give the note’s uri (from resources/list).');
        const r = await backend.readResource(uri).catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }));
        if ('error' in r) return err(id, -32002, r.error.slice(0, 2000));
        return ok(id, { contents: [r] });
      }
      case 'prompts/list':
        return ok(id, { prompts: [] });
      case 'ping':
        return ok(id, {});
      default:
        // notifications/* with an id, $/cancel and anything else unknown.
        return method.startsWith('notifications/') || method.startsWith('$/') ? ok(id, {}) : err(id, -32601, `There is no method called ${method.slice(0, 60)}.`);
    }
  } catch (e) {
    return err(id, -32603, e instanceof Error ? e.message.slice(0, 2000) : String(e).slice(0, 2000));
  }
}

async function callTool(backend: LocalMcpBackend, m: Record<string, unknown>): Promise<LocalMcpCallResult> {
  const params = paramsOf(m);
  const name = typeof params.name === 'string' ? params.name.trim() : '';
  if (!name) return { text: 'Give the tool’s name.', isError: true };
  const args = params.arguments && typeof params.arguments === 'object' && !Array.isArray(params.arguments) ? (params.arguments as Record<string, unknown>) : {};
  try {
    return await backend.call(name.slice(0, 120), args);
  } catch (e) {
    // A tool's failure is its answer (isError), not a broken connection.
    return { text: e instanceof Error ? e.message : String(e), isError: true };
  }
}

/** The stdio loop: stdin lines in, answers on stdout, logs (never secrets, never tool text) to the log. Resolves when
 *  stdin ends. Answers go out in the order their messages arrived. */
export class McpLocalServer {
  private buf = '';
  private queue: Promise<void> = Promise.resolve();
  private ended = false;

  constructor(private readonly backend: LocalMcpBackend, private readonly opts: { input: NodeJS.ReadableStream; output: NodeJS.WritableStream; log?(message: string): void }) {}

  start(): Promise<void> {
    const { input, output, log } = this.opts;
    return new Promise((resolve) => {
      const finish = () => {
        if (!this.ended) {
          this.ended = true;
          resolve();
        }
      };
      const fail = (message: string) => {
        try {
          log?.(message);
        } catch {
          // Logging never breaks the loop.
        }
        try {
          (input as unknown as { destroy?(): void }).destroy?.();
        } catch {
          // Already gone.
        }
        finish();
      };
      input.on('data', (chunk: unknown) => {
        this.buf += typeof chunk === 'string' ? chunk : Buffer.from(chunk as Uint8Array).toString('utf8');
        if (this.buf.length > MCP_MAX_LINE + 65536) return fail('mcp: a message longer than 4 MB was dropped with the connection.');
        this.queue = this.queue.then(() => this.drain(output)).catch((e: unknown) => fail(`mcp: ${e instanceof Error ? e.message : String(e)}`));
      });
      input.on('end', () => {
        this.queue = this.queue.then(() => undefined).catch(() => undefined).then(finish);
      });
      input.on('close', finish);
      input.on('error', (e: unknown) => fail(`mcp: stdin closed (${e instanceof Error ? e.message : String(e)})`));
      output.on('error', (e: unknown) => fail(`mcp: stdout closed (${e instanceof Error ? e.message : String(e)})`));
    });
  }

  private async drain(output: NodeJS.WritableStream): Promise<void> {
    for (;;) {
      const nl = this.buf.indexOf('\n');
      if (nl < 0) return;
      const line = this.buf.slice(0, nl).replace(/\r$/, '');
      this.buf = this.buf.slice(nl + 1);
      if (!line.trim()) continue;
      if (line.length > MCP_MAX_LINE) {
        try {
          this.opts.log?.('mcp: a message longer than 4 MB was dropped.');
        } catch {
          // Logging never breaks the loop.
        }
        continue;
      }
      const out = await handleMcpLine(this.backend, line);
      if (out !== null && !this.ended) output.write(`${out}\n`);
    }
  }
}
