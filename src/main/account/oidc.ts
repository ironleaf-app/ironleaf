// SPDX-License-Identifier: AGPL-3.0-or-later
// Signing in with Kaitiaki ID: OpenID Connect, authorization code with PKCE (RFC 7636), a public client (no secret in the
// app), the browser coming back to a loopback address on this PC (RFC 8252; src/main/account/loopback.ts). Pure: every
// network call goes through the fetch it is handed, so the checks run it against the fake (tools/cloud-fake.mjs).
//
// What is checked, so nothing here has to be taken on trust:
//   - state: the browser's answer must carry the state this sign-in made (a page elsewhere cannot finish a sign-in);
//   - nonce: the ID token must carry the nonce this sign-in made (a token from another sign-in is not accepted);
//   - the ID token's signature (the issuer's published keys), issuer, audience (this app) and expiry.

import { createHash, randomBytes } from 'node:crypto';

export type Fetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; redirect?: 'follow' | 'manual' }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  revocation_endpoint?: string;
  end_session_endpoint?: string;
}

export interface Tokens {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  /** When the access token stops working (ms since 1970). */
  expiresAt: number;
}

export interface Profile {
  /** The account id (the ID token's sub). */
  sub: string;
  name: string;
  email: string;
}

export class SignInError extends Error {
  constructor(
    message: string,
    readonly code: 'state' | 'nonce' | 'denied' | 'network' | 'token' | 'timeout' | 'cancelled' | 'config',
  ) {
    super(message);
  }
}

const b64url = (buf: Buffer) => buf.toString('base64url');

/** A PKCE verifier: 32 random bytes, 43 characters (RFC 7636 §4.1 allows 43–128). */
export const makeVerifier = (): string => b64url(randomBytes(32));
export const challengeOf = (verifier: string): string => b64url(createHash('sha256').update(verifier).digest());
/** state and nonce: 24 random bytes each, never reused. */
export const randomToken = (): string => b64url(randomBytes(24));

export interface PendingSignIn {
  verifier: string;
  state: string;
  nonce: string;
  redirectUri: string;
  url: string;
}

/** Everything one sign-in needs, and the address to open in the browser. */
export function beginSignIn(o: { discovery: Discovery; clientId: string; scope: string; redirectUri: string }): PendingSignIn {
  const verifier = makeVerifier();
  const state = randomToken();
  const nonce = randomToken();
  const u = new URL(o.discovery.authorization_endpoint);
  const q = u.searchParams;
  q.set('response_type', 'code');
  q.set('client_id', o.clientId);
  q.set('redirect_uri', o.redirectUri);
  q.set('scope', o.scope);
  q.set('state', state);
  q.set('nonce', nonce);
  q.set('code_challenge', challengeOf(verifier));
  q.set('code_challenge_method', 'S256');
  return { verifier, state, nonce, redirectUri: o.redirectUri, url: u.toString() };
}

/** The browser's answer at the loopback address: the code, once the state matches. Throws a SignInError otherwise. */
export function readCallback(query: URLSearchParams, expectedState: string): string {
  const state = query.get('state') ?? '';
  // Checked first: an answer that is not for this sign-in says nothing about it, error or not.
  if (!state || !timingSafeEqualStr(state, expectedState)) throw new SignInError('The sign-in answer was not for this sign-in, so it was ignored.', 'state');
  const err = query.get('error');
  if (err) throw new SignInError(err === 'access_denied' ? 'Sign-in was cancelled.' : `Sign-in did not finish (${err.slice(0, 60)}).`, 'denied');
  const code = query.get('code');
  if (!code) throw new SignInError('The sign-in answer had no code.', 'token');
  return code;
}

function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function json(res: { ok: boolean; status: number; text(): Promise<string> }, what: string): Promise<Record<string, unknown>> {
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  if (!res.ok) {
    const e = body && typeof body === 'object' ? (body as Record<string, unknown>).error : undefined;
    throw new SignInError(`${what} failed (${res.status}${typeof e === 'string' ? `, ${e.slice(0, 60)}` : ''}).`, 'token');
  }
  if (!body || typeof body !== 'object') throw new SignInError(`${what} answered with something that is not JSON.`, 'token');
  return body as Record<string, unknown>;
}

export async function discover(issuer: string, fetch: Fetch): Promise<Discovery> {
  let res;
  try {
    res = await fetch(`${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`);
  } catch {
    throw new SignInError('Kaitiaki ID could not be reached. Check the connection and try again.', 'network');
  }
  const d = await json(res, 'Reading Kaitiaki ID’s settings');
  for (const k of ['issuer', 'authorization_endpoint', 'token_endpoint', 'jwks_uri'] as const) if (typeof d[k] !== 'string') throw new SignInError(`Kaitiaki ID’s settings have no ${k}.`, 'config');
  if ((d.issuer as string).replace(/\/$/, '') !== issuer.replace(/\/$/, '')) throw new SignInError('Kaitiaki ID’s settings name another issuer.', 'config');
  return d as unknown as Discovery;
}

const form = (fields: Record<string, string>) => new URLSearchParams(fields).toString();
const FORM = { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' };

function tokensFrom(body: Record<string, unknown>, now: number, previous?: Tokens): Tokens {
  if (typeof body.access_token !== 'string' || !body.access_token) throw new SignInError('Kaitiaki ID gave no access token.', 'token');
  const life = typeof body.expires_in === 'number' && body.expires_in > 0 ? body.expires_in : 300;
  return {
    accessToken: body.access_token,
    // A refresh answer may leave the refresh token out (it stays the same) or rotate it.
    ...(typeof body.refresh_token === 'string' ? { refreshToken: body.refresh_token } : previous?.refreshToken ? { refreshToken: previous.refreshToken } : {}),
    ...(typeof body.id_token === 'string' ? { idToken: body.id_token } : previous?.idToken ? { idToken: previous.idToken } : {}),
    expiresAt: now + life * 1000,
  };
}

/** Trades the code for tokens (with the PKCE verifier), then checks the ID token: signature, issuer, audience, nonce. */
export async function finishSignIn(o: { discovery: Discovery; clientId: string; pending: PendingSignIn; code: string; fetch: Fetch; now?: number }): Promise<{ tokens: Tokens; profile: Profile }> {
  const now = o.now ?? Date.now();
  let res;
  try {
    res = await o.fetch(o.discovery.token_endpoint, { method: 'POST', headers: FORM, body: form({ grant_type: 'authorization_code', code: o.code, redirect_uri: o.pending.redirectUri, client_id: o.clientId, code_verifier: o.pending.verifier }) });
  } catch {
    throw new SignInError('Kaitiaki ID could not be reached to finish signing in.', 'network');
  }
  const tokens = tokensFrom(await json(res, 'Finishing sign-in'), now);
  if (!tokens.idToken) throw new SignInError('Kaitiaki ID gave no ID token.', 'token');
  const profile = await checkIdToken({ idToken: tokens.idToken, discovery: o.discovery, clientId: o.clientId, nonce: o.pending.nonce, fetch: o.fetch, now });
  return { tokens, profile };
}

/** The ID token checked against the issuer's published keys; the nonce must be this sign-in's. */
export async function checkIdToken(o: { idToken: string; discovery: Discovery; clientId: string; nonce: string; fetch: Fetch; now?: number }): Promise<Profile> {
  const jose = await import('jose');
  let keys;
  try {
    keys = jose.createLocalJWKSet((await json(await o.fetch(o.discovery.jwks_uri), 'Reading Kaitiaki ID’s keys')) as unknown as import('jose').JSONWebKeySet);
  } catch (err) {
    if (err instanceof SignInError) throw err;
    throw new SignInError('Kaitiaki ID’s keys could not be read.', 'network');
  }
  let payload: Record<string, unknown>;
  try {
    ({ payload } = await jose.jwtVerify(o.idToken, keys, { issuer: o.discovery.issuer, audience: o.clientId, currentDate: new Date(o.now ?? Date.now()), clockTolerance: 120 }));
  } catch {
    throw new SignInError('Kaitiaki ID’s answer could not be checked, so it was not accepted.', 'token');
  }
  if (typeof payload.nonce !== 'string' || !timingSafeEqualStr(payload.nonce, o.nonce)) throw new SignInError('The sign-in answer was for another sign-in, so it was not accepted.', 'nonce');
  return profileOf(payload);
}

export function profileOf(claims: Record<string, unknown>): Profile {
  const s = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, 200) : '');
  const email = s(claims.email);
  const name = s(claims.name) || [s(claims.given_name), s(claims.family_name)].filter(Boolean).join(' ') || s(claims.preferred_username) || email;
  return { sub: s(claims.sub), name, email };
}

/** A fresh access token from the refresh token. A refusal (400/401) means the sign-in is over: SignInError 'denied'. */
export async function refreshTokens(o: { discovery: Discovery; clientId: string; tokens: Tokens; fetch: Fetch; now?: number }): Promise<Tokens> {
  if (!o.tokens.refreshToken) throw new SignInError('This sign-in cannot be renewed; sign in again.', 'denied');
  let res;
  try {
    res = await o.fetch(o.discovery.token_endpoint, { method: 'POST', headers: FORM, body: form({ grant_type: 'refresh_token', refresh_token: o.tokens.refreshToken, client_id: o.clientId }) });
  } catch {
    throw new SignInError('Kaitiaki ID could not be reached.', 'network');
  }
  if (res.status === 400 || res.status === 401) throw new SignInError('Your sign-in has ended; sign in again.', 'denied');
  if (!res.ok) throw new SignInError(`Kaitiaki ID did not renew the sign-in (${res.status}).`, 'network');
  return tokensFrom(await json(res, 'Renewing sign-in'), o.now ?? Date.now(), o.tokens);
}

/** Revokes the refresh token (and the access token) at Kaitiaki ID. Best effort: never throws. */
export async function revokeTokens(o: { discovery: Discovery; clientId: string; tokens: Tokens; fetch: Fetch }): Promise<boolean> {
  if (!o.discovery.revocation_endpoint) return false;
  let ok = true;
  for (const [token, hint] of [
    [o.tokens.refreshToken, 'refresh_token'],
    [o.tokens.accessToken, 'access_token'],
  ] as const) {
    if (!token) continue;
    try {
      const res = await o.fetch(o.discovery.revocation_endpoint, { method: 'POST', headers: FORM, body: form({ token, token_type_hint: hint, client_id: o.clientId }) });
      ok &&= res.ok;
    } catch {
      ok = false;
    }
  }
  return ok;
}
