// SPDX-License-Identifier: AGPL-3.0-or-later
// Settings › Teams (Ironleaf Teams; Ironleaf Cloud's docs/TEAMS.md). With a Teams licence: the team, its seats, its
// members and roles (owners and admins invite by email, change roles, remove), its shared vaults (make one from the
// open notes, or sync the open notes with one), and the policy the team sets, shown as "Managed by your team". The
// admin console proper (billing, SSO set-up, audit export) is on the website; this is the everyday part. The work is
// src/main/teams/core.ts; this page only shows its view and calls it.

import { useEffect, useState } from 'react';
import type { TeamsView } from '../../../main/teams/view';
import { errorMessage } from '../lib/errors';
import { confirm, prompt } from './Dialogs';
import { Icon } from './Icon';
import { Row } from './Settings';

const day = (t: number) => (t ? new Date(t).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const ROLE_WORDS = { owner: 'Owner', admin: 'Admin', member: 'Member' } as const;

export function TeamsSettings() {
  const [v, setV] = useState<TeamsView | null>(null);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'member' | 'admin'>('member');

  useEffect(() => {
    let live = true;
    const api = window.nv.teams;
    void api.view().then((x) => live && setV(x)).catch((err) => live && setSaid(errorMessage(err)));
    const off = api.onChange((x) => live && setV(x));
    return () => {
      live = false;
      off();
    };
  }, []);

  const act = async (fn: () => Promise<TeamsView>, done?: string) => {
    setBusy(true);
    setSaid(null);
    try {
      setV(await fn());
      if (done) setSaid(done);
      return true;
    } catch (err) {
      setSaid(errorMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (!v) return <p className="setting-said">Loading…</p>;

  if (v.status !== 'ready' || !v.team) {
    const words =
      v.status === 'signed-out'
        ? 'Sign in to your Ironleaf account (Settings › Account and plan) to see your team.'
        : v.status === 'no-teams'
          ? 'Teams is for groups of 3 or more: shared vaults, single sign-on and a policy for everyone’s Ironleaf. Get it in Settings › Account and plan.'
          : 'Your plan includes Teams, but you are not in a team yet. Accept your invite link, or ask your team’s admin.';
    return (
      <>
        <p className="setting-said">{words}</p>
        {v.error && <p className="setting-said warn">{v.error}</p>}
        {said && <p className="setting-said">{said}</p>}
      </>
    );
  }

  const t = v.team;
  const invite = async () => {
    if (await act(() => window.nv.teams.invite(email, role), `Invited ${email}. They get an email with a link.`)) setEmail('');
  };
  const makeVault = async () => {
    const name = await prompt('Share these notes with the team', { message: 'The open notes become a shared vault every member can sync. Its name is only seen by the team.', placeholder: 'Shared vault name', ok: 'Share' });
    if (name) await act(() => window.nv.teams.createVault(name), 'Shared. Verify a member’s PC to give it access.');
  };

  return (
    <>
      <p className="setting-said">
        <Icon name="people" size={14} /> <b>{t.name}</b>: you are {ROLE_WORDS[t.role].toLowerCase()}. {t.seatsUsed} of {t.seats} seats used{t.sso ? '; sign-in goes through your organisation' : ''}.
      </p>
      {v.error && <p className="setting-said warn">{v.error}</p>}
      {v.notes.map((n) => (
        <p key={n} className="setting-said">
          {n}
        </p>
      ))}
      {said && <p className="setting-said">{said}</p>}

      {v.teams.length > 1 && (
        <Row title="Team" hint="You are in more than one team.">
          <select className="setting-input" value={t.id} onChange={(e) => void act(() => window.nv.teams.view(e.target.value))}>
            {v.teams.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </Row>
      )}

      <h3>Members</h3>
      {v.members.map((m) => (
        <Row key={m.accountId} title={`${m.name || m.email}${m.me ? ' (you)' : ''}`} hint={m.name ? m.email : undefined}>
          {t.isOwner && !m.me && m.role !== 'owner' ? (
            <select className="setting-input" disabled={busy} value={m.role} onChange={(e) => void act(() => window.nv.teams.setRole(m.accountId, e.target.value as 'admin' | 'member'))}>
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
          ) : (
            <span className="capture-status">{ROLE_WORDS[m.role]}</span>
          )}
          {m.role !== 'owner' && (m.me || t.isOwner || (t.canAdmin && m.role === 'member')) && (
            <button
              className="button"
              disabled={busy}
              onClick={() =>
                void confirm(m.me ? `Leave ${t.name}?` : `Remove ${m.name || m.email} from ${t.name}?`, { message: 'Shared vaults get a new key, so they can’t open anything added from now on. What is on their PCs already stays there.', ok: m.me ? 'Leave' : 'Remove', danger: true }).then((ok) => ok && act(() => window.nv.teams.remove(m.accountId)))
              }
            >
              {m.me ? 'Leave' : 'Remove'}
            </button>
          )}
        </Row>
      ))}

      {t.canAdmin && (
        <>
          <Row title="Invite someone" hint={t.seatsUsed >= t.seats ? 'All seats are taken. Add seats in Manage billing (Settings › Account and plan).' : 'They get an email with a link and sign in with that address.'} stacked>
            <div className="field-row">
              <input className="setting-input" type="email" style={{ width: 240 }} value={email} placeholder="name@company.com" onChange={(e) => setEmail(e.target.value)} />
              {t.isOwner && (
                <select className="setting-input" value={role} onChange={(e) => setRole(e.target.value as 'member' | 'admin')}>
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
              )}
              <button className="button primary" disabled={busy || !email.includes('@') || t.seatsUsed >= t.seats} onClick={() => void invite()}>
                Invite
              </button>
            </div>
          </Row>
          {v.invites.map((i) => (
            <Row key={i.id} title={i.email} hint={`Invited as ${ROLE_WORDS[i.role].toLowerCase()}; the link works until ${day(i.expires)}.`}>
              <button className="button" disabled={busy} onClick={() => void act(() => window.nv.teams.revokeInvite(i.id), 'Invite withdrawn.')}>
                Withdraw
              </button>
            </Row>
          ))}
        </>
      )}

      <h3>Shared vaults</h3>
      <p className="setting-said">End-to-end encrypted like Sync: each member’s PC holds the key, the cloud never sees names or words.</p>
      {!v.keyProtected && <p className="setting-said warn">This PC can’t protect a team key (no system keyring), so shared vaults can’t be used here.</p>}
      {v.deviceCode && <Row title="This PC’s verification code" hint="Give this code directly to the person sharing the vault."><code>{v.deviceCode}</code></Row>}
      {v.vaults.map((x) => (
        <Row key={x.id} title={x.name ?? 'A shared vault'} hint={x.here ? 'These notes sync with it.' : !x.hasKey ? 'Ask someone with access to verify your PC code, then enter their vault code here.' : x.rotationNeeded ? 'Someone left: an admin’s Ironleaf makes a new key.' : 'Ready to sync on this PC.'}>
          {x.code && <code title="Vault verification code">{x.code}</code>}
          <button className="button" disabled={busy || !v.keyProtected} onClick={async () => {
            const code = await prompt(x.hasKey ? 'Verify a member’s PC' : 'Verify this vault', { message: x.hasKey ? 'Ask the member directly for the code shown on their PC in Settings › Teams.' : 'Ask the person sharing this vault directly for its vault code.', ok: 'Verify' });
            if (code) await act(() => window.nv.teams.verify(x.id, code));
          }}>{x.hasKey ? 'Verify a PC' : 'Verify vault'}</button>
          {x.hasKey && !x.here && (
            <button className="button" disabled={busy || !v.here.notesOpen || v.here.syncOn} title={v.here.syncOn ? 'These notes already sync. Open an empty notes folder first.' : undefined} onClick={() => void act(() => window.nv.teams.joinVault(x.id), 'These notes now sync with the shared vault.')}>
              Sync these notes with it
            </button>
          )}
          {t.canAdmin && x.hasKey && (
            <button className="button" disabled={busy} onClick={() => void confirm('Make a new key for this shared vault?', { message: 'Everything added from now on uses the new key. Every member’s PC gets it.' }).then((ok) => ok && act(() => window.nv.teams.rotate(x.id), 'New key made.'))}>
              New key
            </button>
          )}
        </Row>
      ))}
      {!v.vaults.length && <p className="setting-said">No shared vaults yet.</p>}
      {t.canAdmin && (
        <Row title="Share these notes with the team" hint={!v.here.notesOpen ? 'Open the notes to share first.' : v.here.syncOn ? 'These notes already sync. Turn sync off in Backups and sync first.' : 'The open notes become a shared vault.'}>
          <button className="button primary" disabled={busy || !v.here.notesOpen || v.here.syncOn || !v.keyProtected} onClick={() => void makeVault()}>
            Share…
          </button>
        </Row>
      )}

      <h3>Team policy</h3>
      {v.policy.applied && v.policy.words.length ? (
        <div className="managed-notice" role="note" style={{ margin: '0 0 12px', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border, rgba(127,127,127,.3))', fontSize: 13 }}>
          <b>Managed by your team.</b> {v.policy.words.join(' ')}
          {v.policy.updatedAt ? ` (Set ${day(v.policy.updatedAt)}.)` : ''}
        </div>
      ) : (
        <p className="setting-said">Your team sets no policy: every choice in Ironleaf is yours.</p>
      )}
      {v.audit.on && (
        <Row title="Audit trail" hint={`Your team asks for what AI apps and agents do here (which agent, which tool, the outcome; never a note). ${v.audit.sent} sent this session${v.audit.waiting ? `, ${v.audit.waiting} waiting` : ''}.`}>
          <button className="button" disabled={busy} onClick={() => void act(() => window.nv.teams.uploadNow())}>
            Send now
          </button>
        </Row>
      )}
    </>
  );
}
