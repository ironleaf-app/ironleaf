// Check now (26 Oct 2026; src/shared/systems.ts PROBE/readProbe): a machine read over SSH with its own linked login (a
// password, or a private key kept as the secret's value). Read-only commands; nothing on the machine is changed. Its host
// key is learnt the first time and must match after that (kept in Ironleaf's own data), so a different machine at the
// same address is refused rather than trusted.

import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { Client } from '../vendor/ssh2.cjs';

export interface ProbeLogin {
  username: string;
  value: string;
}

export { addressOf } from '../../shared/machine-address';
import { addressOf } from '../../shared/machine-address';

export async function runProbe(address: string, login: ProbeLogin, script: string, dataDir: string): Promise<string> {
  const where = addressOf(address);
  if (!where) throw new Error('Its address isn’t one Ironleaf can reach (a name or IP, with :port when it isn’t 22).');
  const username = login.username || where.user || '';
  if (!username) throw new Error('Its login has no user name. Add the user name to the login in Secrets.');
  const keysFile = path.join(dataDir, 'known-machines.json');
  const known: Record<string, string> = JSON.parse(await fsp.readFile(keysFile, 'utf8').catch(() => '{}'));
  const id = `${where.host}:${where.port}`;
  let seen = '';
  const key = /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(login.value);
  return new Promise((resolve, reject) => {
    const c = new Client();
    let out = '';
    const fail = (e: Error) => {
      c.end();
      reject(e);
    };
    const timer = setTimeout(() => fail(new Error('It took too long to answer (40 seconds).')), 40_000);
    c.on('ready', () => {
      c.exec(script, (err, stream) => {
        if (err) return fail(err);
        stream.on('data', (d: Buffer) => {
          if (out.length < 400_000) out += d.toString('utf8');
        });
        stream.stderr.on('data', () => {});
        stream.on('close', async () => {
          clearTimeout(timer);
          c.end();
          if (!known[id] && seen) await fsp.mkdir(dataDir, { recursive: true }).then(() => fsp.writeFile(keysFile, JSON.stringify({ ...known, [id]: seen }), 'utf8')).catch(() => {});
          resolve(out);
        });
      });
    });
    c.on('error', (e: Error & { level?: string; code?: string }) => {
      clearTimeout(timer);
      reject(
        new Error(
          e.level === 'client-authentication'
            ? 'It refused the login. Check the user name and password in Secrets.'
            : e.code === 'ECONNREFUSED'
              ? 'It refused the connection (nothing answering SSH on that port).'
              : e.code === 'ETIMEDOUT' || e.code === 'EHOSTUNREACH' || e.code === 'ENETUNREACH'
                ? 'It can’t be reached from this PC.'
                : e.code === 'ENOTFOUND'
                  ? 'Its address can’t be found.'
                  : e.message,
        ),
      );
    });
    c.connect({
      host: where.host,
      port: where.port,
      username,
      ...(key ? { privateKey: login.value } : { password: login.value, tryKeyboard: true }),
      readyTimeout: 15_000,
      hostVerifier: (hostKey: Buffer) => {
        seen = createHash('sha256').update(hostKey).digest('base64');
        return !known[id] || known[id] === seen;
      },
    });
    c.on('keyboard-interactive', (_name, _instr, _lang, prompts, finish) => finish(prompts.map(() => login.value)));
  });
}
