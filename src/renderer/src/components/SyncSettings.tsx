// Settings › Backups and sync › Ironleaf Sync (docs/SYNC.md): end-to-end encrypted sync of these notes across the
// person's PCs through their Ironleaf account. Off by default; turning it on needs the account with Sync, then making
// the sync vault (a passphrase, and a recovery key shown once) or joining the one their other PC made. Once on: how it
// stands, Sync now, Pause, storage used, this vault's PCs, folders left out, and Turn off on this PC. The work is
// src/main/sync/service.ts.

import { useEffect, useState } from 'react';
import type { SyncView } from '../../../main/sync/view';
import { errorMessage } from '../lib/errors';
import { confirm } from './Dialogs';
import { Icon } from './Icon';
import { Row, Toggle } from './Settings';

const when = (t: number) => (t ? new Date(t).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '');
const size = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(0, Math.round(b / 1e3))} KB`);

function statusWords(v: SyncView): { words: string; tone: '' | 'ok' | 'warn' } {
  const extra = [v.waiting > 0 && `${v.waiting} waiting`, v.skipped > 0 && `${v.skipped} couldn’t be read`].filter(Boolean).join(', ');
  const tail = extra ? ` ${extra}.` : '';
  switch (v.phase) {
    case 'syncing':
      return { words: 'Syncing…', tone: '' };
    case 'paused':
      return { words: `Paused. Changes wait here until you resume.${tail}`, tone: 'warn' };
    case 'read-only':
      return { words: 'Waiting: another app has these notes open for writing.', tone: 'warn' };
    case 'offline':
    case 'error':
      return { words: `${v.error || 'Sync didn’t finish.'}${tail}`, tone: 'warn' };
    default:
      return v.lastOk ? { words: `Up to date (${when(v.lastOk)}).${tail}`, tone: v.waiting ? 'warn' : 'ok' } : { words: 'Starting…', tone: '' };
  }
}

export function SyncSettings() {
  const [v, setV] = useState<SyncView | null>(null);
  const [setup, setSetup] = useState(false);
  const [pass, setPass] = useState('');
  const [again, setAgain] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [recoveryIn, setRecoveryIn] = useState('');
  const [recovery, setRecovery] = useState<string | null>(null);
  const [folder, setFolder] = useState('');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void window.nv.cloudSync.view().then((x) => live && setV(x)).catch(() => {});
    const off = window.nv.cloudSync.onChange((x) => live && setV(x));
    return () => {
      live = false;
      off();
    };
  }, []);

  const act = async (fn: () => Promise<SyncView>, done?: string) => {
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

  if (!v) return null;
  const clear = () => {
    setPass('');
    setAgain('');
    setRecoveryIn('');
  };

  const create = async () => {
    if (pass !== again) return setSaid('The two passphrases aren’t the same.');
    setBusy(true);
    setSaid(null);
    try {
      const r = await window.nv.cloudSync.create(pass);
      setV(r.view);
      setRecovery(r.recovery);
      setSetup(false);
      clear();
    } catch (err) {
      setSaid(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const join = async () => {
    if (useRecovery && pass && pass !== again) return setSaid('The two new passphrases aren’t the same.');
    const ok = await act(() => window.nv.cloudSync.join(useRecovery ? { recovery: recoveryIn, ...(pass ? { newPassphrase: pass } : {}) } : { passphrase: pass }), 'Joined. Your notes sync with your other PCs now.');
    if (ok) {
      setSetup(false);
      clear();
    }
  };

  const status = statusWords(v);
  return (
    <>
      <h3>Ironleaf Sync</h3>
      <p className="setting-said backup-protects">Your notes on all your PCs, end-to-end encrypted: only your passphrase opens them; the sync service sees neither names nor words.</p>
      {v.team && <p className="setting-said">These notes sync with your team’s shared vault (Settings › Teams): its key is on each member’s PC, not a passphrase.</p>}

      {recovery && (
        <Row title="Your recovery key" hint="Shown once. Keep it somewhere safe away from this PC (a password manager, or printed). With it you can set a new passphrase if you forget yours; without both, nobody can open your synced notes." stacked>
          <div className="field-row">
            <code className="sync-recovery" style={{ userSelect: 'all', fontSize: 13, wordBreak: 'break-all' }}>{recovery}</code>
            <button className="button" onClick={() => void navigator.clipboard.writeText(recovery).then(() => setSaid('Copied.'))}>
              <Icon name="copy" size={14} /> Copy
            </button>
            <button className="button primary" onClick={() => (setRecovery(null), setSaid(null))}>
              I’ve kept it
            </button>
          </div>
        </Row>
      )}

      {!v.on ? (
        <>
          <Row title="Sync these notes" hint={v.noVault ? 'Open your notes first.' : !v.signedIn ? 'Needs your Ironleaf account with Sync.' : !v.entitled ? 'Your account doesn’t include Sync yet.' : 'Off. Turn on to set up sync on this PC.'}>
            <Toggle label="Ironleaf Sync" value={setup} onChange={(on) => (setSetup(on && !v.noVault), setSaid(null), clear())} />
          </Row>
          {setup && !v.signedIn && (
            <Row title="Sign in" hint="Sign in to your Ironleaf account to use Sync.">
              {v.canSignIn ? (
                <button className="button primary" disabled={busy} onClick={() => void act(() => window.nv.cloudSync.signIn())}>
                  Sign in…
                </button>
              ) : (
                <span className="capture-status">Account sign-in isn’t available in this build yet.</span>
              )}
            </Row>
          )}
          {setup && v.signedIn && !v.entitled && (
            <Row title="Sync isn’t on your plan" hint="Add Sync to your Ironleaf account; this page updates when you come back.">
              {v.canUpgrade ? (
                <button className="button primary" disabled={busy} onClick={() => void act(() => window.nv.cloudSync.upgrade())}>
                  Upgrade…
                </button>
              ) : null}
            </Row>
          )}
          {setup && v.signedIn && v.entitled && !v.existing && (
            <Row title="Choose a sync passphrase" hint="At least 10 characters; a few words you’ll remember is best. Your other PCs join with it. It never leaves this PC." stacked>
              <div className="field-row">
                <input className="setting-input" type="password" style={{ width: 200 }} value={pass} placeholder="Passphrase" autoComplete="new-password" onChange={(e) => setPass(e.target.value)} />
                <input className="setting-input" type="password" style={{ width: 200 }} value={again} placeholder="Type it again" autoComplete="new-password" onChange={(e) => setAgain(e.target.value)} />
                <button className="button primary" disabled={busy || pass.length < 10 || !again} onClick={() => void create()}>
                  {busy ? 'Setting up…' : 'Set up sync'}
                </button>
              </div>
            </Row>
          )}
          {setup && v.signedIn && v.entitled && v.existing && (
            <Row title={useRecovery ? 'Your recovery key' : 'Your sync passphrase'} hint={useRecovery ? 'The key you kept when sync was set up. You can choose a new passphrase with it.' : 'Your account already syncs notes from another PC. Type the passphrase you chose there.'} stacked>
              <div className="field-row">
                {useRecovery ? (
                  <>
                    <input className="setting-input" style={{ width: 300 }} value={recoveryIn} placeholder="Recovery key (13 groups of 4)" autoComplete="off" spellCheck={false} onChange={(e) => setRecoveryIn(e.target.value)} />
                    <input className="setting-input" type="password" style={{ width: 170 }} value={pass} placeholder="New passphrase" autoComplete="new-password" onChange={(e) => setPass(e.target.value)} />
                    <input className="setting-input" type="password" style={{ width: 170 }} value={again} placeholder="Type it again" autoComplete="new-password" onChange={(e) => setAgain(e.target.value)} />
                  </>
                ) : (
                  <input className="setting-input" type="password" style={{ width: 220 }} value={pass} placeholder="Passphrase" autoComplete="current-password" onChange={(e) => setPass(e.target.value)} />
                )}
                <button className="button primary" disabled={busy || (useRecovery ? recoveryIn.replace(/[\s-]/g, '').length < 52 : !pass)} onClick={() => void join()}>
                  {busy ? 'Joining…' : 'Join'}
                </button>
                <button className="button" disabled={busy} onClick={() => (setUseRecovery(!useRecovery), clear())}>
                  {useRecovery ? 'Use the passphrase' : 'Forgot it?'}
                </button>
              </div>
            </Row>
          )}
        </>
      ) : (
        <>
          <Row title="Sync" hint={<span className={`capture-status ${status.tone}${status.tone === 'warn' ? ' backup-error' : ''}`}>{status.words}</span>}>
            <div className="field-row">
              <button className="button" disabled={busy || v.phase === 'paused'} onClick={() => void act(() => window.nv.cloudSync.now())}>
                <Icon name="refresh" size={14} /> Sync now
              </button>
              <button className="button" disabled={busy} onClick={() => void act(() => window.nv.cloudSync.pause(v.phase !== 'paused'))}>
                {v.phase === 'paused' ? 'Resume' : 'Pause'}
              </button>
            </div>
          </Row>
          {v.conflicts > 0 && (
            <p className="setting-said">{`A file changed on two PCs at once ${v.conflicts === 1 ? 'once' : `${v.conflicts} times`}: both versions are kept, the other one named “(conflict, …)”. Keep the one you want and delete the other.`}</p>
          )}
          {v.usage && (
            <Row title="Storage" hint={`${size(v.usage.bytes)} of ${size(v.usage.quota)} used, on ${v.usage.devices} of ${v.usage.maxDevices} PCs.`}>
              <progress max={v.usage.quota || 1} value={v.usage.bytes} style={{ width: 140 }} aria-label="Sync storage used" />
            </Row>
          )}
          {v.devices.length > 0 && (
            <Row title="PCs" hint="The PCs syncing these notes, and when each last checked in." stacked>
              <div className="sync-devices">
                {v.devices.map((d) => (
                  <div key={d.id} className="field-row">
                    <span>
                      <b>{d.name}</b>
                      {d.me ? ' (this PC)' : ''} <span className="capture-status">{when(d.lastSeen)}</span>
                    </span>
                    {!d.me && (
                      <button
                        className="icon-button small"
                        title={`Remove ${d.name}`}
                        disabled={busy}
                        onClick={() =>
                          void confirm(`Remove ${d.name} from sync?`, { message: 'It stops syncing. Its notes stay on it. To stop it for good, also change your sync passphrase.', ok: 'Remove', danger: true }).then((ok) => ok && act(() => window.nv.cloudSync.removeDevice(d.id)))
                        }
                      >
                        <Icon name="trash" size={13} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </Row>
          )}
          <Row title="Folders left out" hint="Not synced to or from this PC (big videos, say). They stay as they are everywhere else." stacked>
            <div className="sync-excluded">
              {v.excluded.map((f) => (
                <div key={f} className="field-row">
                  <span>{f}</span>
                  <button className="icon-button small" title={`Sync ${f} again`} disabled={busy} onClick={() => void act(() => window.nv.cloudSync.exclude(v.excluded.filter((x) => x !== f)))}>
                    <Icon name="close" size={13} />
                  </button>
                </div>
              ))}
              <div className="field-row">
                <input className="setting-input" style={{ width: 220 }} value={folder} placeholder="Folder in your notes, e.g. Videos" spellCheck={false} onChange={(e) => setFolder(e.target.value)} />
                <button className="button" disabled={busy || !folder.trim()} onClick={() => void act(() => window.nv.cloudSync.exclude([...v.excluded, folder.trim()])).then((ok) => ok && setFolder(''))}>
                  Leave out
                </button>
              </div>
            </div>
          </Row>
          <Row title="Turn off on this PC" hint="This PC stops syncing; its notes stay as they are, and your other PCs carry on.">
            <button
              className="button"
              disabled={busy}
              onClick={() => void confirm('Turn off Ironleaf Sync on this PC?', { message: 'Your notes stay here as they are. To sync again, turn it back on and type your passphrase.', ok: 'Turn off' }).then((ok) => ok && act(() => window.nv.cloudSync.off(), 'Sync is off on this PC.'))}
            >
              Turn off
            </button>
          </Row>
        </>
      )}
      {said && <p className="setting-said">{said}</p>}
    </>
  );
}
