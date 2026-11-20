// SPDX-License-Identifier: AGPL-3.0-or-later
// The account, start to end: sign in (oidc.ts + loopback.ts), keep the sign-in sealed (token-store.ts), talk to the
// cloud (cloud-api.ts), keep the licence fresh (licence.ts), and tell the window what to show (AccountView, no token in
// it, ever). No Electron here: src/main/account/index.ts hands it the browser, the protected store and the network,
// and the checks hand it the fake cloud (tools/cloud-fake.mjs).

import { entitlementsOf, TEAMS_MIN_SEATS, type AccountView, type CheckoutProduct } from '../../shared/account';
import { currentEdition, type Edition } from '../edition';
import { cloudApi, CloudError, type CloudApi, type DeviceInfo } from './cloud-api';
import { safeBrowserUrl, type CloudConfig } from './config';
import { LicenceKeeper } from './licence';
import { openLoopback, type Loopback } from './loopback';
import { beginSignIn, discover, finishSignIn, refreshTokens, revokeTokens, SignInError, type Discovery, type Fetch } from './oidc';
import { TokenStore, type SignedIn } from './token-store';

export interface AccountDeps {
  config: CloudConfig;
  fetch: Fetch;
  store: TokenStore;
  licence: LicenceKeeper;
  /** Opens an address in the person's own browser (shell.openExternal). */
  openBrowser(url: string): Promise<void>;
  device(): DeviceInfo;
  /** The window is told the view changed. */
  changed(view: AccountView): void;
  /** Brings Ironleaf's window forward after the browser has had the focus. */
  focusApp?(): void;
  log?(message: string): void;
  now?(): number;
  /** The edition in force (edition.ts), for the view. */
  edition?(): Edition;
  managedWords?: string;
  signInTimeoutMs?: number;
}

const RENEW_MARGIN_MS = 60_000;

export class AccountService {
  private discovery: Discovery | null = null;
  private loopback: Loopback | null = null;
  private signingIn = false;
  private renewing: Promise<boolean> | null = null;
  private syncing: Promise<void> | null = null;
  private me: AccountView['me'];
  private online: boolean | undefined;
  private refreshedAt: number | undefined;
  private error: string | undefined;
  /** Checkout or the billing portal is open in the browser: the plan is read again when Ironleaf has the focus back. */
  private awaitingBrowser = false;
  readonly api: CloudApi;

  constructor(private d: AccountDeps) {
    this.api = cloudApi({ apiBase: d.config.apiBase, fetch: d.fetch, token: () => this.accessToken(), renew: () => this.renew() });
  }

  private now(): number {
    return this.d.now?.() ?? Date.now();
  }
  private log(m: string): void {
    this.d.log?.(`Account: ${m}`);
  }

  /** Reads the sealed sign-in (if any). Call once at start. */
  async load(): Promise<void> {
    await this.d.store.load();
    this.refreshedAt = (await this.d.licence.state()).refreshedAt;
  }

  get signedIn(): SignedIn | null {
    return this.d.store.get();
  }

  view(): AccountView {
    const c = this.d.config;
    const e = this.d.edition?.() ?? currentEdition();
    const licence = e.licence ? { edition: e.id, words: e.words, until: e.licence.exp * 1000, features: e.licence.features, org: e.licence.org } : null;
    const base = { persistent: this.d.store.persistent, licence, ...(this.d.managedWords ? { managed: this.d.managedWords } : {}) };
    if (c.disabled) return { status: 'off', ...base };
    if (!c.configured) return { status: 'unconfigured', ...base };
    const s = this.signedIn;
    const extra = { ...(this.error ? { error: this.error } : {}), ...(this.refreshedAt ? { refreshedAt: this.refreshedAt } : {}), ...(this.online !== undefined ? { online: this.online } : {}) };
    if (this.signingIn) return { status: 'signing-in', ...base, ...extra };
    if (!s) return { status: 'signed-out', ...base, ...extra };
    return { status: 'signed-in', ...base, ...extra, profile: { name: s.profile.name, email: s.profile.email }, ...(this.me ? { me: this.me } : {}), ...(s.deviceId ? { deviceId: s.deviceId } : {}) };
  }

  private emit(): AccountView {
    const v = this.view();
    this.d.changed(v);
    return v;
  }

  private async disc(): Promise<Discovery> {
    this.discovery ??= await discover(this.d.config.issuer, this.d.fetch);
    return this.discovery;
  }

  // ── Sign in and out ───────────────────────────────────────────────────────────────────────────────────────────────

  /** The whole sign-in: the browser opens Kaitiaki ID, comes back to this PC, the tokens are checked and sealed, this
   *  PC is registered and the licence fetched. Resolves with the view either way (an error is in view.error). */
  async signIn(): Promise<AccountView> {
    const c = this.d.config;
    if (c.disabled || !c.configured) return this.emit();
    if (this.signingIn) return this.view();
    this.signingIn = true;
    this.error = undefined;
    this.emit();
    try {
      const discovery = await this.disc();
      this.loopback?.close();
      const loop = (this.loopback = await openLoopback({ timeoutMs: this.d.signInTimeoutMs }));
      const pending = beginSignIn({ discovery, clientId: c.clientId, scope: c.scope, redirectUri: loop.redirectUri });
      const answer = loop.wait(pending.state);
      try {
        await this.d.openBrowser(pending.url);
        const code = await answer;
        const { tokens, profile } = await finishSignIn({ discovery, clientId: c.clientId, pending, code, fetch: this.d.fetch, now: this.now() });
        await this.d.store.save({ tokens, profile });
        this.log(`signed in (${profile.sub.slice(0, 8)}…)`);
      } finally {
        loop.close();
        if (this.loopback === loop) this.loopback = null;
        answer.catch(() => {});
      }
      this.signingIn = false;
      this.d.focusApp?.();
      await this.sync({ force: true });
    } catch (err) {
      const e = err as SignInError;
      this.error = e?.code === 'cancelled' ? undefined : (e?.message ?? 'Sign-in did not finish.');
      if (e?.code !== 'cancelled') this.log(`sign-in did not finish: ${e?.message}`);
    } finally {
      this.signingIn = false;
    }
    return this.emit();
  }

  /** Stops a sign-in that is waiting on the browser. */
  cancel(): AccountView {
    this.loopback?.close();
    return this.view();
  }

  /** Signs out: tokens revoked at Kaitiaki ID (best effort), the sealed file removed, the licence this PC was given
   *  removed (one placed by hand stays), the edition read again. */
  async signOut(): Promise<AccountView> {
    const s = this.signedIn;
    this.loopback?.close();
    if (s) {
      try {
        await revokeTokens({ discovery: await this.disc(), clientId: this.d.config.clientId, tokens: s.tokens, fetch: this.d.fetch });
      } catch {
        // Offline: the tokens are forgotten here all the same, and the refresh token lapses on its own.
      }
    }
    await this.d.store.clear();
    this.me = undefined;
    this.error = undefined;
    this.refreshedAt = undefined;
    await this.d.licence.forget();
    this.log('signed out');
    return this.emit();
  }

  // ── Tokens ────────────────────────────────────────────────────────────────────────────────────────────────────────

  private async accessToken(): Promise<string> {
    const s = this.signedIn;
    if (!s) throw new CloudError('Not signed in.', 401);
    if (s.tokens.expiresAt - RENEW_MARGIN_MS <= this.now()) await this.renew();
    const t = this.signedIn?.tokens.accessToken;
    if (!t) throw new CloudError('Not signed in.', 401);
    return t;
  }

  /** A fresh access token. false when the sign-in has ended (then this PC is signed out, the licence kept to its end). */
  private renew(): Promise<boolean> {
    this.renewing ??= (async () => {
      const s = this.signedIn;
      if (!s) return false;
      try {
        const tokens = await refreshTokens({ discovery: await this.disc(), clientId: this.d.config.clientId, tokens: s.tokens, fetch: this.d.fetch, now: this.now() });
        await this.d.store.save({ ...s, tokens });
        return true;
      } catch (err) {
        if ((err as SignInError).code === 'denied') {
          this.log('the sign-in has ended');
          await this.d.store.clear();
          this.me = undefined;
          this.error = 'Your sign-in has ended. Sign in again to keep your plan up to date.';
          this.emit();
          return false;
        }
        throw new CloudError((err as Error).message, 0);
      }
    })().finally(() => (this.renewing = null));
    return this.renewing;
  }

  /** For the paid cloud parts (Sync, Teams): a current access token, or null when signed out or it cannot be renewed
   *  (offline). Never throws. */
  async getAccessToken(): Promise<string | null> {
    if (!this.signedIn || this.d.config.disabled) return null;
    try {
      return await this.accessToken();
    } catch {
      return null;
    }
  }

  /** Whether the account holds an entitlement: the licence in force (works offline), or the cloud's word while online. */
  hasEntitlement(key: string): boolean {
    return entitlementsOf(this.view()).includes(key);
  }

  /** The signed-in account's id at the cloud, when /me has answered this run. */
  get accountId(): string | undefined {
    return this.me?.account.id || undefined;
  }

  // ── Bringing the plan and licence up to date ──────────────────────────────────────────────────────────────────────

  /** Whether the daily check is due (or the licence is near its end). */
  due(): boolean {
    const e = this.d.edition?.() ?? currentEdition();
    return LicenceKeeper.due({ now: this.now(), refreshedAt: this.refreshedAt, licenceUntil: e.licence ? e.licence.exp * 1000 : undefined });
  }

  /** The account (GET /me), this PC registered (POST /devices), and the licence (POST /licence). Offline: nothing
   *  changes and the licence in force stays. Never throws. */
  sync(o: { force?: boolean } = {}): Promise<void> {
    this.syncing ??= this.doSync(o).finally(() => (this.syncing = null));
    return this.syncing;
  }

  private async doSync(o: { force?: boolean }): Promise<void> {
    if (!this.signedIn || this.d.config.disabled) return;
    if (!o.force && !this.due() && this.me) return;
    try {
      this.me = await this.api.me();
      this.online = true;
      const s = this.signedIn;
      if (s && (!s.deviceId || !this.me.devices.some((d) => d.id === s!.deviceId))) {
        await this.register();
        this.me = await this.api.me();
      }
      if (o.force || this.due()) {
        const r = await this.d.licence.refresh(() => this.licenceForThisDevice(), this.now());
        if (r.outcome !== 'offline') this.refreshedAt = (await this.d.licence.state()).refreshedAt ?? this.now();
        if (r.error) this.log(r.error);
        this.log(`licence ${r.outcome}: ${r.edition.words}`);
      }
      this.error = undefined;
    } catch (err) {
      if (err instanceof CloudError && err.offline) this.online = false;
      else if (this.signedIn) this.error = (err as Error).message;
      this.log(`could not bring the plan up to date: ${(err as Error).message}`);
    }
    this.emit();
  }

  /** POST /licence for this PC; a device the cloud has dropped is registered again once. */
  private async licenceForThisDevice(): Promise<string | null> {
    const s = this.signedIn;
    if (!s) throw new CloudError('Not signed in.', 401);
    const id = s.deviceId ?? (await this.register());
    try {
      return await this.api.licence(id);
    } catch (err) {
      if (!(err instanceof CloudError && err.status === 404 && err.code === 'device_not_found')) throw err;
      return this.api.licence(await this.register());
    }
  }

  private async register(): Promise<string> {
    const deviceId = await this.api.registerDevice(this.d.device());
    const s = this.signedIn;
    if (s) await this.d.store.save({ ...s, deviceId });
    return deviceId;
  }

  /** Ironleaf's window has the focus again after Checkout or the billing portal: the plan is read again (once). */
  async returned(): Promise<void> {
    if (!this.awaitingBrowser || !this.signedIn) return;
    this.awaitingBrowser = false;
    await this.sync({ force: true });
  }

  /** The hourly tick: a lapsed licence is read again (Community, quietly), and the daily check runs when due. */
  async tick(): Promise<void> {
    const e = this.d.edition?.() ?? currentEdition();
    if (e.licence && e.licence.exp * 1000 <= this.now()) {
      await this.d.licence.reread();
      this.emit();
    }
    // The plan is read once a run (the page shows it); the licence only when its day has come.
    if (this.signedIn && (this.due() || !this.me)) await this.sync();
  }

  // ── Devices and billing ───────────────────────────────────────────────────────────────────────────────────────────

  private async act(what: () => Promise<void>): Promise<AccountView> {
    try {
      await what();
      this.error = undefined;
    } catch (err) {
      this.error = err instanceof CloudError && err.offline ? 'Ironleaf Cloud could not be reached. Check the connection and try again.' : (err as Error).message;
      if (err instanceof CloudError && err.offline) this.online = false;
    }
    return this.emit();
  }

  renameDevice(id: string, name: string): Promise<AccountView> {
    const clean = String(name ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 60);
    return this.act(async () => {
      if (!clean) throw new Error('A device needs a name.');
      await this.api.renameDevice(String(id), clean);
      this.me = await this.api.me();
    });
  }

  removeDevice(id: string): Promise<AccountView> {
    return this.act(async () => {
      if (id === this.signedIn?.deviceId) throw new Error('To take this PC off your account, sign out.');
      await this.api.removeDevice(String(id));
      this.me = await this.api.me();
    });
  }

  private async openFromCloud(get: () => Promise<string>): Promise<void> {
    const url = safeBrowserUrl(await get(), this.d.config);
    if (!url) throw new Error('Ironleaf Cloud gave an address that is not safe to open.');
    this.awaitingBrowser = true;
    await this.d.openBrowser(url);
  }

  /** Manage billing: the billing portal, in the browser. */
  portal(): Promise<AccountView> {
    return this.act(() => this.openFromCloud(() => this.api.portal()));
  }

  /** Upgrade: Checkout for one product, in the browser. The plan updates at the next check (or Refresh). */
  checkout(p: CheckoutProduct): Promise<AccountView> {
    return this.act(async () => {
      const body = cleanCheckout(p);
      if (!body) throw new Error('That is not something Ironleaf sells.');
      await this.openFromCloud(() => this.api.checkout(body));
    });
  }
}

/** The window's Checkout request as contract v1's body: exactly the fields each product takes (the cloud refuses others). */
export function cleanCheckout(p: unknown): CheckoutProduct | null {
  const o = p && typeof p === 'object' ? (p as Record<string, unknown>) : {};
  if (o.product === 'supporter') return { product: 'supporter' };
  if (o.product === 'sync') return { product: 'sync', interval: o.interval === 'year' ? 'year' : 'month' };
  if (o.product === 'teams') {
    const teamName = typeof o.teamName === 'string' ? o.teamName.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 100) : '';
    const seats = typeof o.seats === 'number' && Number.isInteger(o.seats) ? Math.max(TEAMS_MIN_SEATS, Math.min(o.seats, 1000)) : TEAMS_MIN_SEATS;
    return teamName ? { product: 'teams', seats, teamName } : null;
  }
  return null;
}
