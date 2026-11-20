// "ironleaf mcp" on every system (20 Nov 2026, standalone, workstream B): Ironleaf started with the word mcp
// ("Ironleaf mcp", "Ironleaf.AppImage mcp", or the ironleaf command) becomes a stdio bridge to the
// Ironleaf running on this PC, as the Windows command script is (src/main/windows-entry.ts): each stdin line is
// posted to /mcp on the command's local connection (127.0.0.1, the secret from cli.json in Ironleaf's own data) and
// each answer goes out on stdout, one a line. Nothing is logged to stdout. When Ironleaf isn't running it is
// started (without this word) and waited for, so the library opens as it always does.

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { runningAppImage } from './update-check';

/** The words after the program (and, in a development build, after its folder). */
export function isMcpCommand(argv: readonly string[], packaged: boolean): boolean {
  const words = argv.slice(packaged ? 1 : 2).filter((a) => !a.startsWith('-'));
  return words[0] === 'mcp';
}

interface Endpoint {
  port: number;
  token: string;
}

function readEndpoint(file: string): Endpoint | null {
  try {
    const ep = JSON.parse(readFileSync(file, 'utf8')) as Partial<Endpoint>;
    return typeof ep.port === 'number' && typeof ep.token === 'string' ? { port: ep.port, token: ep.token } : null;
  } catch {
    return null;
  }
}

function post(ep: Endpoint, line: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: ep.port, path: '/mcp', method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8', 'x-neuralvault-cli': ep.token, 'content-length': Buffer.byteLength(line) }, timeout: 300_000 }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('Ironleaf took too long to answer.')));
    req.on('error', reject);
    req.end(line);
  });
}

const idOf = (line: string): string | number | null => {
  try {
    const m = JSON.parse(line) as { id?: unknown };
    return typeof m.id === 'string' || typeof m.id === 'number' ? m.id : null;
  } catch {
    return null;
  }
};

export interface BridgeOptions {
  endpointFile: string;
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
  /** Ironleaf started when it isn't running. */
  launch?(): void;
  log?(message: string): void;
  /** How long to wait for it to start (ms). */
  waitMs?: number;
}

/** The bridge run until stdin ends. */
export async function runMcpBridge(o: BridgeOptions): Promise<void> {
  let ep = readEndpoint(o.endpointFile);
  let launched = false;
  const ensure = async (): Promise<Endpoint | null> => {
    if (ep) return ep;
    if (!launched && o.launch) {
      launched = true;
      try {
        o.launch();
      } catch (err) {
        o.log?.(`ironleaf mcp: Ironleaf couldn’t be started (${err instanceof Error ? err.message : String(err)}).`);
      }
    }
    const until = Date.now() + (o.waitMs ?? 60_000);
    while (!ep && Date.now() < until) {
      await new Promise((r) => setTimeout(r, 400));
      ep = readEndpoint(o.endpointFile);
    }
    return ep;
  };
  const answer = async (line: string): Promise<string | null> => {
    const id = idOf(line);
    const fail = (message: string) => (id === null ? null : JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32603, message } }));
    for (let attempt = 0; attempt < 2; attempt++) {
      const at = await ensure();
      if (!at) return fail('Ironleaf did not answer. Open Ironleaf, then try again.');
      try {
        const r = await post(at, line);
        if (r.status === 204 || !r.body.trim()) return null;
        if (r.status === 200) return r.body.trim();
        if (r.status === 403) {
          // A newer Ironleaf wrote its own secret: read it again once.
          ep = readEndpoint(o.endpointFile);
          continue;
        }
        return fail(`Ironleaf answered ${r.status}.`);
      } catch {
        // Closed since cli.json was written (Ironleaf restarted or quit): find it again.
        ep = null;
      }
    }
    return fail('Ironleaf did not answer. Open Ironleaf, then try again.');
  };
  await new Promise<void>((resolve) => {
    let buf = '';
    let queue = Promise.resolve();
    let ended = false;
    const done = () => {
      if (!ended) {
        ended = true;
        void queue.then(resolve, resolve);
      }
    };
    o.input.on('data', (chunk: unknown) => {
      buf += typeof chunk === 'string' ? chunk : Buffer.from(chunk as Uint8Array).toString('utf8');
      for (let nl = buf.indexOf('\n'); nl >= 0; nl = buf.indexOf('\n')) {
        const line = buf.slice(0, nl).replace(/\r$/, '');
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        queue = queue.then(async () => {
          const out = await answer(line);
          if (out !== null) o.output.write(`${out}\n`);
        });
      }
    });
    o.input.on('end', done);
    o.input.on('close', done);
    o.input.on('error', done);
  });
}

/** Ironleaf started on its own, without the word mcp (detached: it outlives the bridge). The AppImage is started
 *  only when this program provably runs from it (an APPIMAGE inherited from the environment is not followed). */
export function launchIronleaf(argv: readonly string[], packaged: boolean): void {
  const exe = runningAppImage() ?? process.execPath;
  const args = packaged ? [] : argv.slice(1, 2);
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  spawn(exe, args, { detached: true, stdio: 'ignore', env }).unref();
}
