// SPDX-License-Identifier: AGPL-3.0-or-later
// An Ironleaf account as the window sees it (Settings › Account and plan, the Supporter badge), and the rules that turn
// what the main side knows into what the page shows. Shared by src/main/account (which builds AccountView) and the
// window (components/account), and checked on its own (tests/account.test.mjs). No token is ever part of a view.
//
// An account is optional. Notes, search, the graph, the assistant, backups, plugins: none of it ever asks for one.
// Signing in unlocks the paid cloud products (Sync, Teams) and says thank you to a Supporter.

/** Entitlement keys (Ironleaf Cloud's docs/CONTRACT.md "Products and entitlements"). */
export type Entitlement = 'supporter' | 'sync' | 'teams' | 'sso' | 'admin' | 'audit' | 'enterprise' | 'commercial-licence' | 'ai' | 'publish';

export interface CloudDevice {
  id: string;
  name: string;
  platform: string;
  /** Last seen (ms since 1970), when the cloud says. */
  lastSeen?: number;
}

export interface CloudMe {
  account: { id: string; name: string; email: string };
  /** The plan's name as the cloud words it ("Community", "Sync", "Teams"), and when it renews or ends. */
  plan: { id: string; name: string; renews?: number; ends?: number };
  entitlements: string[];
  devices: CloudDevice[];
  /** How many devices the plan allows. */
  deviceLimit?: number;
  teams?: { id: string; name: string; role: string }[];
}

/** POST /checkout's body (contract v1): Supporter; Sync monthly or yearly; Teams with its seats (3 or more) and name. */
export type CheckoutProduct = { product: 'supporter' } | { product: 'sync'; interval: 'month' | 'year' } | { product: 'teams'; seats: number; teamName: string };
export const TEAMS_MIN_SEATS = 3;

export type AccountStatus = 'off' | 'unconfigured' | 'signed-out' | 'signing-in' | 'signed-in';

export interface AccountView {
  status: AccountStatus;
  /** The sign-in is kept between starts (the OS protected store is there); false: until Ironleaf quits. */
  persistent: boolean;
  profile?: { name: string; email: string };
  /** The cloud's answer to GET /me, when there has been one this run. */
  me?: CloudMe;
  /** This PC's id at the cloud. */
  deviceId?: string;
  /** The licence in force (src/main/edition.ts), whatever wrote it. */
  licence?: { edition: string; words: string; until: number; features: string[]; org: string } | null;
  /** false: the last call found no connection (the licence in force is kept until it expires). */
  online?: boolean;
  /** When the plan and licence were last brought up to date (ms). */
  refreshedAt?: number;
  /** A plain sentence about the last thing that went wrong, if anything did. */
  error?: string;
  /** Words for an organisation's policy that turned accounts off, or moved the cloud. */
  managed?: string;
}

const s = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const when = (v: unknown): number | undefined => {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v < 1e12 ? v * 1000 : v;
  if (typeof v === 'string' && v) {
    const t = Date.parse(v);
    return Number.isNaN(t) ? undefined : t;
  }
  return undefined;
};

/** GET /me read leniently (Ironleaf Cloud's docs/CONTRACT.md v1: `{account, plan, entitlements: {features, quota, grants},
 *  teams, devices: {limit, items}}`; flat lists are read too). Missing parts are empty, unknown parts ignored. */
export function parseMe(raw: unknown): CloudMe {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const obj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
  const acc = obj(o.account) ?? o;
  const plan = obj(o.plan) ?? { id: o.plan };
  const entObj = obj(o.entitlements);
  const ents = Array.isArray(o.entitlements) ? o.entitlements : Array.isArray(entObj?.features) ? (entObj!.features as unknown[]) : Array.isArray(o.features) ? o.features : [];
  const devObj = obj(o.devices);
  const devs = Array.isArray(o.devices) ? o.devices : Array.isArray(devObj?.items) ? (devObj!.items as unknown[]) : [];
  // When the plan renews: the latest period end among the grants in force (a one-off Supporter has none).
  const grants = Array.isArray(entObj?.grants) ? (entObj!.grants as unknown[]).map(obj).filter((g): g is Record<string, unknown> => !!g && (g.status === 'active' || g.status === 'past_due' || g.status === 'trialing')) : [];
  const renewsFromGrants = grants.map((g) => when(g.currentPeriodEnd)).filter((t): t is number => !!t).sort((x, y) => y - x)[0];
  const renews = when(plan.renews ?? plan.renewsAt) ?? renewsFromGrants;
  const ends = when(plan.ends ?? plan.endsAt);
  const id = s(plan.id, 40) || 'community';
  const limit = typeof devObj?.limit === 'number' && devObj.limit > 0 ? devObj.limit : undefined;
  return {
    account: { id: s(acc.id ?? acc.sub), name: s(acc.name), email: s(acc.email) },
    plan: { id, name: s(plan.name, 60) || planName(id), ...(renews ? { renews } : {}), ...(ends ? { ends } : {}) },
    entitlements: ents.filter((e): e is string => typeof e === 'string' && /^[a-z0-9-]{1,40}$/.test(e)),
    devices: devs
      .map((d) => obj(d) ?? {})
      .filter((d) => typeof d.id === 'string' && d.id)
      .map((d) => ({ id: s(d.id, 80), name: s(d.name, 80) || 'A device', platform: s(d.platform, 20), ...(when(d.lastSeen ?? d.lastSeenAt) ? { lastSeen: when(d.lastSeen ?? d.lastSeenAt) } : {}) })),
    ...(limit ? { deviceLimit: limit } : {}),
    teams: (Array.isArray(o.teams) ? o.teams : []).map((t) => obj(t) ?? {}).filter((t) => typeof t.id === 'string').map((t) => ({ id: s(t.id, 80), name: s(t.name, 100), role: s(t.role, 20) })),
  };
}

/** The cloud's platform names (POST /devices): windows, macos, linux, android, ios, web, other. */
export function cloudPlatform(p: string): 'windows' | 'macos' | 'linux' | 'other' {
  return p === 'win32' ? 'windows' : p === 'darwin' ? 'macos' : p === 'linux' ? 'linux' : 'other';
}

const PLAN_NAMES: Record<string, string> = { community: 'Community', free: 'Community', supporter: 'Supporter', sync: 'Sync', 'personal-sync': 'Sync', teams: 'Teams', enterprise: 'Enterprise' };
export const planName = (id: string): string => PLAN_NAMES[id] ?? (id ? id[0].toUpperCase() + id.slice(1) : 'Community');

/** Each entitlement in words, for the plan's list. */
export const ENTITLEMENT_WORDS: Record<string, string> = {
  supporter: 'Supporter: thank you for keeping Ironleaf open source',
  sync: 'Sync: your notes on every device, end-to-end encrypted',
  teams: 'Teams: shared vaults with your team',
  sso: 'Single sign-on for your organisation',
  admin: 'The admin console: members, seats and policy',
  audit: 'Audit export',
  enterprise: 'Enterprise support',
  'commercial-licence': 'A commercial licence',
  ai: 'Ironleaf AI',
  publish: 'Publish',
};

/** What signing in is for, on the signed-out page (and why it is never needed). */
export const ACCOUNT_PURPOSE = [
  { title: 'Sync', words: 'Your notes on every device, end-to-end encrypted: the cloud never sees what you write.' },
  { title: 'Teams', words: 'Shared vaults, single sign-on and an admin console for a team.' },
  { title: 'Supporting Ironleaf', words: 'A one-off Supporter purchase keeps Ironleaf free and open source.' },
] as const;
export const NEVER_NEEDED = 'Everything Ironleaf does on this PC works without an account, signed in or not. An account is only for the cloud:';

/** Upgrades offered: each product the account does not have yet. Prices are shown at Checkout, never guessed here. */
export const PRODUCTS: { id: CheckoutProduct['product']; label: string; words: string; has: string }[] = [
  { id: 'sync', label: 'Get Sync', words: 'Notes on every device, end-to-end encrypted. Monthly or yearly.', has: 'sync' },
  { id: 'teams', label: 'Get Teams', words: 'Shared vaults and single sign-on for 3 or more.', has: 'teams' },
  { id: 'supporter', label: 'Become a Supporter', words: 'A one-off thank you that keeps Ironleaf open.', has: 'supporter' },
];

/** Everything the account has: the licence in force (which works offline), and the cloud's word while it answers. */
export function entitlementsOf(view: AccountView | null | undefined): string[] {
  if (!view) return [];
  const set = new Set<string>(view.licence?.features ?? []);
  if (view.status === 'signed-in' && view.online !== false) for (const e of view.me?.entitlements ?? []) set.add(e);
  return [...set];
}

export const isSupporter = (view: AccountView | null | undefined): boolean => entitlementsOf(view).includes('supporter');

export interface AccountScreen {
  kind: AccountStatus;
  /** One line under the section heading. */
  lead: string;
  name?: string;
  email?: string;
  plan?: string;
  /** "Renews 3 Dec 2026" / "Licence until …", when known. */
  planWhen?: string;
  features: string[];
  offers: typeof PRODUCTS;
  /** Manage billing: once the account has bought something (the portal has nothing for a free account). */
  billing: boolean;
  supporter: boolean;
  /** A quiet note: offline, kept for this run only, a problem. */
  notes: string[];
}

const day = (t: number) => new Date(t).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });

/** The page's state from the view: what to say and which buttons to show. */
export function accountScreen(view: AccountView | null | undefined): AccountScreen {
  const empty = { features: [], offers: [], billing: false, supporter: false, notes: [] as string[] };
  if (!view) return { kind: 'signed-out', lead: NEVER_NEEDED, ...empty };
  const notes: string[] = [];
  if (view.error) notes.push(view.error);
  if (view.status === 'off') return { kind: 'off', lead: view.managed || 'Accounts are turned off on this PC by your organisation. Everything else in Ironleaf works as usual.', ...empty, notes };
  if (view.status === 'unconfigured') return { kind: 'unconfigured', lead: 'Signing in is not set up in this build of Ironleaf yet. Nothing else depends on it.', ...empty, notes };
  if (view.status === 'signed-out' || view.status === 'signing-in') {
    if (view.status === 'signing-in') notes.unshift('Finish signing in in your browser. This page updates by itself.');
    return { kind: view.status, lead: NEVER_NEEDED, ...empty, supporter: isSupporter(view), notes };
  }
  const ents = entitlementsOf(view);
  const plan = view.me?.plan.name ?? (view.licence ? planName(view.licence.edition) : 'Community');
  const renews = view.me?.plan.renews;
  const ends = view.me?.plan.ends;
  // A one-off Supporter never ends: the licence date is only when this PC next refreshes it, so it isn't shown.
  const oneOff = !renews && !ends && isSupporter(view) && plan.toLowerCase().includes('supporter');
  const planWhen = renews ? `Renews ${day(renews)}` : ends ? `Ends ${day(ends)}` : oneOff ? 'Yours to keep' : view.licence?.until ? `Licence until ${day(view.licence.until)}` : undefined;
  if (view.online === false) notes.push('Offline: your plan stays as it is until its licence ends, and is brought up to date when Ironleaf is back online.');
  if (!view.persistent) notes.push('This PC has no protected store for the sign-in, so you will be asked to sign in again after Ironleaf restarts.');
  return {
    kind: 'signed-in',
    lead: 'Signed in with Kaitiaki ID. Your notes stay on this PC; only the products below use the cloud.',
    name: view.profile?.name || view.me?.account.name || undefined,
    email: view.profile?.email || view.me?.account.email || undefined,
    plan,
    ...(planWhen ? { planWhen } : {}),
    features: ents.map((e) => ENTITLEMENT_WORDS[e]).filter((w): w is string => !!w),
    offers: PRODUCTS.filter((p) => !ents.includes(p.has) && !(p.id === 'sync' && ents.includes('teams'))),
    billing: ents.some((e) => e !== 'supporter') || !!renews,
    supporter: ents.includes('supporter'),
    notes,
  };
}

/** A device's line: "Linux · seen 3 Dec 2026", "This PC". */
export function deviceWords(d: CloudDevice, thisDevice?: string): string {
  const where = d.platform ? ({ win32: 'Windows', windows: 'Windows', darwin: 'macOS', macos: 'macOS', linux: 'Linux', android: 'Android', ios: 'iOS', web: 'Web', other: '' } as Record<string, string>)[d.platform] ?? d.platform : '';
  if (d.id === thisDevice) return [where, 'this PC'].filter(Boolean).join(' · ');
  return [where, d.lastSeen ? `seen ${day(d.lastSeen)}` : ''].filter(Boolean).join(' · ');
}
