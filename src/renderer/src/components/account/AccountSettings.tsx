// SPDX-License-Identifier: AGPL-3.0-or-later
// Settings › Account and plan (20 Nov 2026). Signed out: what an account is for (Sync, Teams, supporting Ironleaf) and
// that notes never need one, with one button. Signed in: who, the plan and what it includes, Upgrade (Checkout in the
// browser), Manage billing (the billing portal in the browser), this account's devices (rename, remove) and Sign out.
// Everything reads the shared view (accountState.ts); the words and which buttons show are src/shared/account.ts.
import { useEffect, useRef } from 'react';
import { ACCOUNT_PURPOSE, accountScreen, deviceWords, TEAMS_MIN_SEATS, type AccountView } from '../../../../shared/account';
import { confirm, prompt } from '../Dialogs';
import { Icon, type IconName } from '../Icon';
import { Row } from '../Settings';
import { account, useAccount } from './accountState';
import { SupporterBadge } from './SupporterBadge';
import '../../styles/account.css';

const PURPOSE_ICONS: IconName[] = ['cloud', 'people', 'heart'];

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('') || '?';

function SignedOut({ view }: { view: AccountView | null }) {
  const screen = accountScreen(view);
  const waiting = screen.kind === 'signing-in';
  const can = screen.kind === 'signed-out' || waiting;
  return (
    <>
      <section className="acct-intro" data-setting="Your account">
        <p className="acct-lead">{screen.lead}</p>
        <ul className="acct-purpose">
          {ACCOUNT_PURPOSE.map((p, i) => (
            <li key={p.title}>
              <Icon name={PURPOSE_ICONS[i]!} size={18} />
              <div>
                <b>{p.title}</b>
                <span>{p.words}</span>
              </div>
            </li>
          ))}
        </ul>
        {can && (
          <div className="acct-actions">
            {waiting ? (
              <>
                <button className="button" disabled>
                  Waiting for your browser…
                </button>
                <button className="link-button" onClick={() => void account.cancel()}>
                  Cancel
                </button>
              </>
            ) : (
              <button className="button primary" onClick={() => void account.signIn()}>
                Sign in or create an account
              </button>
            )}
            <span className="acct-quiet">With Kaitiaki ID, in your browser.</span>
          </div>
        )}
        {screen.kind !== 'signed-out' && screen.kind !== 'signing-in' && <p className="acct-quiet">{screen.lead}</p>}
        {screen.notes.map((n) => (
          <p key={n} className="acct-note" role="status">
            {n}
          </p>
        ))}
      </section>
    </>
  );
}

function SignedIn({ view }: { view: AccountView }) {
  const screen = accountScreen(view);
  const devices = view.me?.devices ?? [];
  const rename = async (id: string, name: string) => {
    const next = await prompt('Rename this device', { value: name, ok: 'Rename' });
    if (next && next.trim() && next.trim() !== name) void account.renameDevice(id, next.trim());
  };
  const remove = async (id: string, name: string) => {
    if (await confirm(`Remove ${name}?`, { message: 'It stops syncing and is signed out of your account. Its notes stay on it.', ok: 'Remove', danger: true })) void account.removeDevice(id);
  };
  const startTeams = async () => {
    const teamName = await prompt('Name your team', { message: `Teams starts at ${TEAMS_MIN_SEATS} seats; you choose the number at Checkout and can change it later.`, placeholder: 'Your team or organisation', ok: 'Continue to Checkout' });
    if (teamName && teamName.trim()) void account.checkout({ product: 'teams', seats: TEAMS_MIN_SEATS, teamName: teamName.trim() });
  };
  const signOut = async () => {
    if (await confirm('Sign out of Ironleaf?', { message: 'Your notes stay exactly as they are. Paid cloud products stop on this PC until you sign in again.', ok: 'Sign out' })) void account.signOut();
  };
  return (
    <>
      <div className="acct-col">
      <div className="acct-who" data-setting="Your account">
        <span className="acct-avatar" aria-hidden="true">
          {initials(screen.name ?? screen.email ?? '')}
        </span>
        <div className="acct-id">
          <div className="acct-name">
            <span className="clip">{screen.name || screen.email}</span>
            {screen.supporter && <SupporterBadge />}
          </div>
          {screen.name && screen.email && <div className="acct-email clip">{screen.email}</div>}
        </div>
        <button className="button" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
      <p className="acct-quiet acct-sub">{screen.lead}</p>

      <h3>Plan</h3>
      <Row title="Your plan" hint={screen.planWhen ?? (screen.features.length ? undefined : 'Community: every feature of Ironleaf, free and open source.')}>
        <span className="tag slate acct-plan">{screen.plan}</span>
        {screen.billing && (
          <button className="button" onClick={() => void account.portal()}>
            Manage billing <Icon name="external" size={12} />
          </button>
        )}
      </Row>
      {screen.features.length > 0 && (
        <ul className="acct-features" aria-label="What your plan includes">
          {screen.features.map((f) => (
            <li key={f}>
              <Icon name="check" size={14} />
              {f}
            </li>
          ))}
        </ul>
      )}

      {screen.offers.length > 0 && (
        <>
          <h3>Upgrade</h3>
          <div className="acct-offers" data-setting="Upgrade">
            {screen.offers.map((o) => (
              <div key={o.id} className="acct-offer">
                <p>{o.words}</p>
                <div className="acct-offer-buttons">
                  {o.id === 'sync' ? (
                    <>
                      <button className="button primary" onClick={() => void account.checkout({ product: 'sync', interval: 'year' })}>
                        Sync yearly <Icon name="external" size={12} />
                      </button>
                      <button className="button" onClick={() => void account.checkout({ product: 'sync', interval: 'month' })}>
                        Monthly <Icon name="external" size={12} />
                      </button>
                    </>
                  ) : (
                    <button className="button" onClick={() => void (o.id === 'teams' ? startTeams() : account.checkout({ product: 'supporter' }))}>
                      {o.label} <Icon name="external" size={12} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
          <p className="acct-quiet acct-inset">Checkout opens in your browser. Your plan here updates once it is paid.</p>
        </>
      )}
      </div>

      <div className="acct-col">
      <h3>Devices{view.me?.deviceLimit ? <span className="acct-count">{devices.length} of {view.me.deviceLimit}</span> : null}</h3>
      {devices.length === 0 && <p className="acct-quiet acct-inset">{view.online === false ? 'Your devices show here once Ironleaf is back online.' : 'No devices yet.'}</p>}
      {devices.map((d) => (
        <Row key={d.id} title={d.name} hint={deviceWords(d, view.deviceId)} oneLine>
          <button className="link-button" onClick={() => void rename(d.id, d.name)}>
            Rename
          </button>
          {d.id !== view.deviceId && (
            <button className="link-button" onClick={() => void remove(d.id, d.name)}>
              Remove
            </button>
          )}
        </Row>
      ))}

      <div className="acct-foot">
        {screen.notes.map((n) => (
          <p key={n} className="acct-note" role="status">
            {n}
          </p>
        ))}
        <button className="link-button" onClick={() => void account.refresh()}>
          Check now
        </button>
        {view.refreshedAt ? <span className="acct-quiet">Up to date {new Date(view.refreshedAt).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span> : null}
      </div>
      </div>
    </>
  );
}

export function AccountSettings() {
  const view = useAccount();
  // Signed in from an earlier run: the plan and devices are read when the page opens (the licence keeps its own day).
  const asked = useRef(false);
  useEffect(() => {
    if (view?.status === 'signed-in' && !view.me && !asked.current) {
      asked.current = true;
      void account.refresh();
    }
  }, [view]);
  return <div className={`acct-page${view?.status === 'signed-in' ? ' is-in' : ''}`}>{view?.status === 'signed-in' ? <SignedIn view={view} /> : <SignedOut view={view} />}</div>;
}
