// The Vault's local URL for AI apps that take one (20 Nov 2026, standalone, workstream B): MCP's Streamable HTTP on
// 127.0.0.1 only, each request carrying the person's token (Authorization: Bearer). Off until switched on in
// Settings › Connect an AI. Every message is answered by the same handler the stdio command uses
// (src/main/mcp-local.ts handleMcpLine) with the same backend (AgentAccess.asLocalMcp: the switch, Read only / Can
// edit, Private notes and Undo). Answers are plain JSON (the transport allows it); there is no server-sent stream, so
// GET is refused with 405 as the transport says.
//
// The token is kept in Ironleaf's own data (mcp-http.json, this user only), never in the notes.

import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { promises as fsp, readFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { handleMcpLine, MCP_MAX_LINE, type LocalMcpBackend } from './mcp-local';
import { mcpHttpUrl } from '../shared/mcp-local';
import type { LocalMcpHttpView } from '../shared/agent-access';

export interface McpHttpOptions {
  dataDir: string;
  backend(): LocalMcpBackend;
  log?(message: string): void;
}

/** A request as the handler reads it (node's IncomingMessage, or a test's stand-in). */
type Req = AsyncIterable<unknown> & { method?: string; url?: string; headers: Record<string, string | string[] | undefined> };
type Res = { writeHead(status: number, headers?: Record<string, string>): unknown; end(body?: string): unknown };

export class McpHttpServer {
  private server: http.Server | null = null;
  private listening: number | null = null;
  private problem: string | undefined;
  private tokenValue: string;
  private readonly file: string;

  constructor(private readonly opts: McpHttpOptions) {
    this.file = path.join(opts.dataDir, 'mcp-http.json');
    let token = '';
    try {
      const kept = JSON.parse(readFileSync(this.file, 'utf8')) as { token?: unknown };
      if (typeof kept.token === 'string' && kept.token.length >= 32) token = kept.token;
    } catch {
      // None kept yet: made below and written on first start.
    }
    this.tokenValue = token || randomBytes(32).toString('base64url');
  }

  get token(): string {
    return this.tokenValue;
  }

  get port(): number | null {
    return this.listening;
  }

  /** The window's view of it. */
  view(port: number): LocalMcpHttpView {
    return { on: this.listening !== null, url: mcpHttpUrl(this.listening ?? port), token: this.tokenValue, ...(this.problem ? { problem: this.problem } : {}) };
  }

  /** A new token (every app given the old one must be given this one). */
  async newToken(): Promise<string> {
    this.tokenValue = randomBytes(32).toString('base64url');
    await this.keep();
    return this.tokenValue;
  }

  private async keep(): Promise<void> {
    await fsp.mkdir(this.opts.dataDir, { recursive: true });
    const tmp = `${this.file}.${randomBytes(4).toString('hex')}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify({ token: this.tokenValue }), { mode: 0o600 });
    await fsp.rename(tmp, this.file);
  }

  /** Listening (or moved to another port) or stopped, to match the person's settings. */
  async sync(want: { on: boolean; port: number }): Promise<void> {
    if (!want.on) return this.stop();
    if (this.listening === want.port) return;
    await this.stop();
    await this.keep().catch(() => undefined);
    const server = http.createServer((req, res) => void this.answer(req as unknown as Req, res));
    server.on('clientError', (_err, socket) => socket.destroy());
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(want.port, '127.0.0.1', () => resolve());
      });
      server.unref();
      this.server = server;
      this.listening = (server.address() as AddressInfo).port;
      this.problem = undefined;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      this.problem = code === 'EADDRINUSE' ? `Port ${want.port} is taken by another program: choose another.` : `The local URL couldn’t start (${err instanceof Error ? err.message : String(err)}).`;
      this.opts.log?.(`Connect an AI: ${this.problem}`);
    }
  }

  async stop(): Promise<void> {
    const s = this.server;
    this.server = null;
    this.listening = null;
    if (s) await new Promise<void>((resolve) => s.close(() => resolve()));
  }

  /** One request answered (public for the tests, which call it without a socket). */
  async answer(req: Req, res: Res, port = this.listening): Promise<void> {
    const plain = (status: number, body: string, headers: Record<string, string> = {}) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
      res.end(body);
    };
    const refused = (status: number, message: string, headers: Record<string, string> = {}) => plain(status, JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32001, message } }), headers);
    const host = String(req.headers.host ?? '');
    const origin = req.headers.origin === undefined ? null : String(req.headers.origin);
    const pathOnly = String(req.url ?? '').split('?')[0];
    if (pathOnly !== '/mcp') return refused(404, 'Not here: the address is /mcp.');
    // DNS rebinding: only this PC's own names, and a browser page only from this PC.
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return refused(403, 'Refused.');
    if (origin !== null && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(origin)) return refused(403, 'Refused.');
    const auth = String(req.headers.authorization ?? '');
    const given = /^Bearer\s+(.+)$/i.exec(auth)?.[1]?.trim() ?? '';
    if (!sameSecret(given, this.tokenValue)) return refused(401, 'The token is missing or wrong: copy it again from Ironleaf (Settings › Connect an AI).', { 'www-authenticate': 'Bearer realm="Ironleaf"' });
    if (req.method === 'GET') return refused(405, 'This server answers POST only (no event stream).', { allow: 'POST, DELETE' });
    if (req.method === 'DELETE') return plain(200, '{}');
    if (req.method !== 'POST') return refused(405, 'This server answers POST only.', { allow: 'POST, DELETE' });
    let size = 0;
    const chunks: Buffer[] = [];
    try {
      for await (const chunk of req) {
        const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
        size += b.length;
        if (size > MCP_MAX_LINE) return refused(413, 'That message is too long.');
        chunks.push(b);
      }
      const body = Buffer.concat(chunks).toString('utf8');
      const out = await handleMcpLine(this.opts.backend(), body);
      if (out === null) {
        res.writeHead(202, { 'cache-control': 'no-store' });
        res.end();
        return;
      }
      // A session id at initialize (clients send it back; every message is answered alike either way).
      const init = /"method"\s*:\s*"initialize"/.test(body);
      return plain(200, out, init ? { 'mcp-session-id': randomUUID() } : {});
    } catch (err) {
      this.opts.log?.(`Connect an AI: ${err instanceof Error ? err.message : String(err)}`);
      return refused(500, 'Ironleaf couldn’t answer that message.');
    }
  }
}

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
