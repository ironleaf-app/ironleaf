#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Issues an Ironleaf licence: Supporter, personal Sync, Teams or Enterprise (an Ed25519-signed JWT; src/main/edition.ts verifies it offline;
// Ironleaf Cloud issues the same shape, its docs/CONTRACT.md v1).
//
//   node tools/licence-issue.mjs --key <private.pem> --org "Acme Pty Ltd" --seats 50 --edition enterprise \
//        --features sso,team-vaults,audit-export --days 365 [--out licence.jwt]
//   node tools/licence-issue.mjs --generate-keypair <dir>     (a NEW keypair for development or a key ceremony)
//
// The private key is read from --key <file> or from the IRONLEAF_LICENCE_PRIVATE_KEY environment variable (the PEM
// text). It is never written anywhere by this script, never committed, and never printed. The public half goes into
// LICENCE_PUBLIC_KEY_PEM in src/main/edition.ts at release.

import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ISSUER = 'https://kaitiaki-it.com/ironleaf';
export const AUDIENCE = 'ironleaf-desktop';

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const name = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[name] = true;
    else (out[name] = next), i++;
  }
  return out;
}

export const EDITIONS = ['supporter', 'personal-sync', 'teams', 'enterprise'];

export async function issueLicence({ privateKeyPem, org, seats, edition, features = [], days = 365, now = Date.now(), jti = randomUUID(), sub, did }) {
  const { SignJWT, importPKCS8 } = await import(pathToFileURL(path.join(root, 'node_modules', 'jose', 'dist', 'webapi', 'index.js')).href);
  if (!org || typeof org !== 'string') throw new Error('--org is required');
  if (!Number.isInteger(seats) || seats < 1) throw new Error('--seats must be a whole number of at least 1');
  if (!EDITIONS.includes(edition)) throw new Error(`--edition must be one of ${EDITIONS.join(', ')}`);
  const key = await importPKCS8(privateKeyPem.trim(), 'EdDSA');
  const iat = Math.floor(now / 1000);
  return new SignJWT({ org, seats, edition, features, ...(did ? { did } : {}) })
    .setProtectedHeader({ alg: 'EdDSA', typ: 'JWT' })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(iat)
    .setNotBefore(iat - 60)
    .setExpirationTime(iat + Math.round(days * 86400))
    .setJti(jti)
    .setSubject(sub ?? `licence:${jti}`)
    .sign(key);
}

export function generateKeypair(dir) {
  mkdirSync(dir, { recursive: true });
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pub = publicKey.export({ type: 'spki', format: 'pem' });
  const priv = privateKey.export({ type: 'pkcs8', format: 'pem' });
  writeFileSync(path.join(dir, 'licence-public.pem'), pub);
  writeFileSync(path.join(dir, 'licence-private.pem'), priv, { mode: 0o600 });
  return { publicPem: pub, privateFile: path.join(dir, 'licence-private.pem'), publicFile: path.join(dir, 'licence-public.pem') };
}

async function main() {
  const a = args(process.argv.slice(2));
  if (a['generate-keypair']) {
    const dir = path.resolve(String(a['generate-keypair']));
    const r = generateKeypair(dir);
    console.log(`Wrote ${r.publicFile} and ${r.privateFile} (keep the private key out of every repository).`);
    return;
  }
  const privateKeyPem = typeof a.key === 'string' ? readFileSync(a.key, 'utf8') : process.env.IRONLEAF_LICENCE_PRIVATE_KEY;
  if (!privateKeyPem) throw new Error('Give the private key with --key <file> or IRONLEAF_LICENCE_PRIVATE_KEY.');
  const token = await issueLicence({
    privateKeyPem,
    org: a.org,
    seats: Number(a.seats),
    edition: a.edition,
    features: typeof a.features === 'string' ? a.features.split(',').map((f) => f.trim()).filter(Boolean) : [],
    days: a.days ? Number(a.days) : 365,
  });
  if (typeof a.out === 'string') {
    writeFileSync(a.out, token + '\n');
    console.log(`Wrote ${a.out}`);
  } else process.stdout.write(token + '\n');
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
