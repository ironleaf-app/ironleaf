// SPDX-License-Identifier: AGPL-3.0-or-later
// The address the browser comes back to after signing in (RFC 8252 §7.3): http://127.0.0.1:<a free port>/callback,
// listening on this PC only, for one answer, then closed. Only an answer carrying this sign-in's state is taken; any
// other request gets a plain 404 and the wait goes on.

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { readCallback, SignInError } from './oidc';

export interface Loopback {
  redirectUri: string;
  /** Resolves with the code once the browser comes back with this state; rejects on a refusal, a timeout or close(). */
  wait(expectedState: string): Promise<string>;
  close(): void;
}

const page = (title: string, words: string) =>
  `<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><title>${title}</title><meta name="viewport" content="width=device-width"><style>body{font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1.5rem;color:#1d2321}h1{font-size:1.4rem}@media(prefers-color-scheme:dark){body{background:#151917;color:#e6ebe8}}</style></head><body><h1>${title}</h1><p>${words}</p></body></html>`;

export async function openLoopback(o: { timeoutMs?: number } = {}): Promise<Loopback> {
  let settle: { resolve(code: string): void; reject(err: Error): void; state: string } | null = null;
  let timer: NodeJS.Timeout | undefined;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (req.method !== 'GET' || url.pathname !== '/callback' || !settle) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
      return;
    }
    try {
      const code = readCallback(url.searchParams, settle.state);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(page('You are signed in to Ironleaf', 'You can close this tab and go back to Ironleaf.'));
      const s = settle;
      settle = null;
      s.resolve(code);
    } catch (err) {
      const e = err as SignInError;
      // An answer for another sign-in is turned away without ending this one.
      if (e.code === 'state') {
        res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' }).end(page('Not for this sign-in', 'This page was not for the sign-in Ironleaf started. Go back to Ironleaf and sign in again.'));
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(page('Sign-in did not finish', `${e.message} You can close this tab and try again in Ironleaf.`));
      const s = settle;
      settle = null;
      s?.reject(e);
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  const close = () => {
    if (timer) clearTimeout(timer);
    server.close();
    server.closeAllConnections?.();
    const s = settle;
    settle = null;
    s?.reject(new SignInError('Sign-in was cancelled.', 'cancelled'));
  };
  return {
    redirectUri: `http://127.0.0.1:${port}/callback`,
    wait: (state) =>
      new Promise<string>((resolve, reject) => {
        settle = { resolve, reject, state };
        timer = setTimeout(() => {
          const s = settle;
          settle = null;
          s?.reject(new SignInError('Sign-in took too long. Try again.', 'timeout'));
        }, o.timeoutMs ?? 5 * 60_000);
      }),
    close,
  };
}
