// SPDX-License-Identifier: AGPL-3.0-or-later
// Signs and checks latest.json for the in-app updater (src/main/update-check.ts verifies the same way).
// latest.json.sig is a compact JWS (EdDSA / Ed25519) whose payload is latest.json's exact bytes, so the SHA-256 of
// every installer that latest.json names is vouched for by the release key, not only by the site that served it.
// The private key comes from NV_UPDATE_SIGNING_KEY_FILE (a PEM file) or NV_UPDATE_SIGNING_KEY (the PEM text) at
// release time. It is never in this repository; tests make a throwaway keypair.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const jose = () => import(pathToFileURL(path.join(root, 'node_modules', 'jose', 'dist', 'webapi', 'index.js')).href);

export async function signLatest(text, privateKeyPem) {
  const { CompactSign, importPKCS8 } = await jose();
  const key = await importPKCS8(privateKeyPem.trim(), 'EdDSA');
  return new CompactSign(new TextEncoder().encode(text)).setProtectedHeader({ alg: 'EdDSA', typ: 'ironleaf-latest+jws' }).sign(key);
}

export async function verifyLatest(text, sig, publicKeyPem) {
  const { compactVerify, importSPKI } = await jose();
  const key = await importSPKI(publicKeyPem.trim(), 'EdDSA');
  const { payload } = await compactVerify(sig.trim(), key, { algorithms: ['EdDSA'] });
  return Buffer.from(payload).equals(Buffer.from(text, 'utf8'));
}

/** The release signing key from the environment, or null. */
export function signingKeyFromEnv(env = process.env) {
  if (env.NV_UPDATE_SIGNING_KEY_FILE) return readFileSync(env.NV_UPDATE_SIGNING_KEY_FILE, 'utf8');
  return env.NV_UPDATE_SIGNING_KEY || null;
}

/** The public key the app embeds (UPDATE_PUBLIC_KEY_PEM in src/main/update-check.ts of the checkout `dir`, this
 *  repository by default); '' while it is the placeholder. */
export function embeddedUpdateKey(dir = root) {
  const src = readFileSync(path.join(dir, 'src', 'main', 'update-check.ts'), 'utf8');
  const m = /export const UPDATE_PUBLIC_KEY_PEM = (`[^`]*`|'[^']*')/.exec(src);
  return m ? m[1].slice(1, -1).replace(/\\n/g, '\n') : '';
}
