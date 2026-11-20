// SPDX-License-Identifier: AGPL-3.0-or-later
// Which edition this copy is (docs/EDITIONS.md). Community unless a valid licence file says otherwise.
//
// Rules, kept here so nobody has to wonder:
//   - Community is the default and is complete. No feature of the community edition is gated on a licence, ever.
//     A licence only tells an optional enterprise module (src/main/enterprise.ts) what the organisation bought.
//   - Licences are verified offline: an Ed25519-signed JWT checked against the public key below. Ironleaf never
//     phones home to check a licence, count seats or report usage.
//   - A missing, unreadable, expired, not-yet-valid or wrongly signed licence falls back to community with a
//     plain message. It never stops the app or takes anything away.
//
// Where the licence is read (first found): the machine-wide file (Windows %ProgramData%\Ironleaf\licence.jwt,
// Linux /etc/ironleaf/licence.jwt, macOS /Library/Application Support/Ironleaf/licence.jwt), then licence.jwt in
// Ironleaf's own data folder (userData). Licences are issued with tools/licence-issue.mjs.

import { readFile } from 'node:fs/promises';
import path from 'node:path';

export type EditionId = 'community' | 'supporter' | 'personal-sync' | 'teams' | 'enterprise';

export interface LicenceClaims {
  /** The organisation's name, as shown on the About page. */
  org: string;
  seats: number;
  edition: Exclude<EditionId, 'community'>;
  /** Feature ids the enterprise module may turn on (e.g. "sso", "team-vaults", "audit-export"). */
  features: string[];
  /** Expiry (seconds since 1970). */
  exp: number;
  iat?: number;
  /** Licence id, for support. */
  jti?: string;
  /** The account (Ironleaf Cloud) and the device it was issued to, when the cloud issued it. */
  sub?: string;
  did?: string;
}

export interface Edition {
  id: EditionId;
  /** The licence's claims when one was accepted. */
  licence: LicenceClaims | null;
  /** In plain words, for the About page ("Community edition", "Enterprise edition for Acme, 50 seats, until …",
   *  or why a licence file was not accepted). */
  words: string;
  /** Where the accepted (or rejected) licence came from. */
  source: string | null;
}

export const LICENCE_ISSUER = 'https://kaitiaki-it.com/ironleaf';
export const LICENCE_AUDIENCE = 'ironleaf-desktop';
export const LICENCE_FILE = 'licence.jwt';
/** The editions a licence can carry (Ironleaf Cloud's docs/CONTRACT.md v1 "Licences"): two for one person, two for an organisation. */
const EDITION_NAMES: Record<Exclude<EditionId, 'community'>, string> = { supporter: 'Supporter', 'personal-sync': 'Sync', teams: 'Teams', enterprise: 'Enterprise' };

// ┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
// │ PLACEHOLDER — REPLACE AT RELEASE. The public half of Kaitiaki IT's licence-signing key (Ed25519, SPKI PEM).      │
// │ Empty means this build accepts no licence at all and is always the community edition. The private half is never │
// │ in this repository: tools/licence-issue.mjs reads it from a file or IRONLEAF_LICENCE_PRIVATE_KEY at issue time.   │
// └──────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
export const LICENCE_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAzSAAN5YlQy8EK9/phpocpkMbDK5fym8YqcgNR2P5ZkQ=
-----END PUBLIC KEY-----`;

export const COMMUNITY: Edition = { id: 'community', licence: null, words: 'Community edition (free and open source, AGPL-3.0-or-later).', source: null };

const community = (why: string, source: string | null): Edition => ({ ...COMMUNITY, words: `${why} Ironleaf runs as the Community edition, with every feature it has.`, source });

/** Checks one licence token. Never throws: anything wrong gives the community edition and the reason in words. */
export async function verifyLicence(token: string, o: { publicKeyPem?: string; now?: Date; source?: string | null } = {}): Promise<Edition> {
  const source = o.source ?? null;
  const pem = o.publicKeyPem ?? LICENCE_PUBLIC_KEY_PEM;
  if (!pem.trim()) return community('This build has no licence key, so the licence file was not read.', source);
  let jose: typeof import('jose');
  try {
    jose = await import('jose');
  } catch {
    return community('The licence could not be checked here.', source);
  }
  try {
    const key = await jose.importSPKI(pem.trim(), 'EdDSA');
    const { payload } = await jose.jwtVerify(token.trim(), key, {
      algorithms: ['EdDSA'],
      issuer: LICENCE_ISSUER,
      audience: LICENCE_AUDIENCE,
      currentDate: o.now ?? new Date(),
      requiredClaims: ['exp'],
    });
    const p = payload as Record<string, unknown>;
    const edition = typeof p.edition === 'string' && p.edition in EDITION_NAMES ? (p.edition as LicenceClaims['edition']) : null;
    // A one-person licence (Supporter, Sync) may leave out the organisation and seats.
    const personal = edition === 'supporter' || edition === 'personal-sync';
    const org = typeof p.org === 'string' ? p.org.trim().slice(0, 120) : '';
    const seats = typeof p.seats === 'number' && Number.isInteger(p.seats) && p.seats > 0 ? p.seats : personal ? 1 : 0;
    if (!edition || (!org && !personal) || !seats) return community('The licence file is missing its organisation, seats or edition.', source);
    const features = Array.isArray(p.features) ? p.features.filter((f): f is string => typeof f === 'string' && /^[a-z0-9-]{1,40}$/.test(f)) : [];
    const licence: LicenceClaims = { org, seats, edition, features, exp: p.exp as number, ...(typeof p.iat === 'number' ? { iat: p.iat } : {}), ...(typeof p.jti === 'string' ? { jti: p.jti } : {}), ...(typeof p.sub === 'string' ? { sub: p.sub.slice(0, 80) } : {}), ...(typeof p.did === 'string' ? { did: p.did.slice(0, 80) } : {}) };
    const until = new Date(licence.exp * 1000).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
    const name = EDITION_NAMES[edition];
    if (personal) return { id: edition, licence, words: `Ironleaf ${name}${org ? ` for ${org}` : ''}, until ${until}. Thank you for supporting Ironleaf.`, source };
    return { id: edition, licence, words: `${name} edition for ${org}, ${seats} seat${seats === 1 ? '' : 's'}, until ${until}.`, source };
  } catch (err) {
    const code = (err as { code?: string })?.code ?? '';
    if (code === 'ERR_JWT_EXPIRED') return community('The licence has expired.', source);
    if (code === 'ERR_JWT_CLAIM_VALIDATION_FAILED') return community('The licence is not for this product, or not valid yet.', source);
    if (code === 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED') return community('The licence’s signature does not match.', source);
    return community('The licence file could not be read as a licence.', source);
  }
}

/** The licence files to look for, machine-wide first. */
export function licenceFiles(o: { platform: NodeJS.Platform; env: Record<string, string | undefined>; userData: string }): string[] {
  const machine =
    o.platform === 'win32'
      ? path.win32.join(o.env.ProgramData || o.env.PROGRAMDATA || 'C:\\ProgramData', 'Ironleaf', LICENCE_FILE)
      : o.platform === 'darwin'
        ? path.posix.join('/Library/Application Support/Ironleaf', LICENCE_FILE)
        : path.posix.join('/etc/ironleaf', LICENCE_FILE);
  return [machine, path.join(o.userData, LICENCE_FILE)];
}

/** Reads the first licence file found and checks it. No file: community, quietly. */
export async function detectEdition(o: { userData: string; platform?: NodeJS.Platform; env?: Record<string, string | undefined>; read?: (file: string) => Promise<string | null>; publicKeyPem?: string; now?: Date }): Promise<Edition> {
  const read = o.read ?? ((file: string) => readFile(file, 'utf8').catch(() => null));
  for (const file of licenceFiles({ platform: o.platform ?? process.platform, env: o.env ?? process.env, userData: o.userData })) {
    const text = await read(file);
    if (text && text.trim()) return verifyLicence(text, { source: file, ...(o.publicKeyPem !== undefined ? { publicKeyPem: o.publicKeyPem } : {}), ...(o.now ? { now: o.now } : {}) });
  }
  return COMMUNITY;
}

let current: Edition = COMMUNITY;
/** The edition in force (community until detectEdition has run at start-up). */
export const currentEdition = (): Edition => current;
export const setCurrentEdition = (e: Edition): void => void (current = e);
