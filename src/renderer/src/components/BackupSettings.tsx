// Settings › Backup and sync (21 Oct 2026, gap G28): the Git backup (a history of the notes, pushed to a remote the
// person chooses) and the encrypted sync folder (a copy only their passphrase opens, in a folder they pick), each saying
// plainly what it protects and what it doesn't, when it last ran and what went wrong. The work is src/main/backup.ts.

import { useEffect, useState } from 'react';
import { BACKUP_MINUTES, PROTECTS, type BackupView } from '../../../shared/backup';
import { plural } from '../../../shared/words';
import { errorMessage } from '../lib/errors';
import { Icon } from './Icon';
import { PortableExportSettings } from './PortableExport';
import { LearnMore, Row, Toggle } from './Settings';
import { VaultTidySettings } from './VaultTidy';

const ago = (t: number) => (t ? new Date(t).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '');
/** A PROTECTS paragraph split for Learn more (9.5 polished): the first sentences lead, the caveats sit behind. */
const protectParts = (text: string) => text.split('. ').map((s, i, a) => (i < a.length - 1 ? `${s}.` : s));
const protectLead = (text: string, n: number) => protectParts(text).slice(0, n).join(' ');
const protectRest = (text: string, n: number) => protectParts(text).slice(n).join(' ');
const everyWords = (m: number) => (m < 60 ? `${plural(m, 'minute')}` : m === 60 ? 'hour' : `${plural(m / 60, 'hour')}`);

function Every({ value, onChange, label }: { value: number; onChange(v: number): void; label: string }) {
  return (
    <select className="setting-input" aria-label={label} style={{ width: 150 }} value={value} onChange={(e) => onChange(Number(e.target.value))}>
      {BACKUP_MINUTES.map((m) => (
        <option key={m} value={m}>
          Every {everyWords(m)}
        </option>
      ))}
    </select>
  );
}

/** How a backup or sync stands: its last good run, what it did, or what went wrong. */
function Status({ busy, lastOk, words, error, working }: { busy: boolean; lastOk: number; words: string; error: string; working: string }) {
  if (busy) return <span className="capture-status">{working}</span>;
  if (error) return <span className="capture-status warn backup-error">{error}</span>;
  if (lastOk) return <span className="capture-status ok">{`Last done ${ago(lastOk)}. ${words}`}</span>;
  return <span className="capture-status">Not run yet.</span>;
}

export function BackupSettings() {
  const [view, setView] = useState<BackupView | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [remote, setRemote] = useState('');
  const [user, setUser] = useState('');
  const [token, setToken] = useState('');
  const [folder, setFolder] = useState<{ folder: string; existing: boolean } | null>(null);
  const [pass, setPass] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void window.nv.backup.view().then((v) => {
      if (!live) return;
      setView(v);
      setRemote(v.git.prefs.remote);
      setUser(v.git.prefs.user);
    });
    const off = window.nv.backup.onChange((v) => live && setView(v));
    return () => {
      live = false;
      off();
    };
  }, []);

  const act = async (fn: () => Promise<BackupView>, done?: string) => {
    setBusy(true);
    setSaid(null);
    try {
      setView(await fn());
      if (done) setSaid(done);
    } catch (err) {
      setSaid(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (!view) return <Row title="Backup and sync" hint="Checking…">{null}</Row>;
  const g = view.git;
  const s = view.sync;
  const https = /^https?:\/\//i.test(g.prefs.remote);
  const pickFolder = async () => {
    setSaid(null);
    try {
      const picked = await window.nv.backup.pickFolder();
      if (picked) {
        setFolder(picked);
        setPass('');
        setAgain('');
      }
    } catch (err) {
      setSaid(errorMessage(err));
    }
  };
  const setUpSync = async () => {
    if (!folder) return;
    if (!folder.existing && pass !== again) return setSaid('The two passphrases aren’t the same.');
    setBusy(true);
    setSaid(null);
    try {
      const r = await window.nv.backup.setUpSync(folder.folder, pass);
      setView(r.view);
      setFolder(null);
      setPass('');
      setAgain('');
      setSaid(r.joined ? 'The passphrase opened the copy your other PC made. Syncing now.' : 'The encrypted copy is set up. Syncing now.');
    } catch (err) {
      setSaid(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h3>Back up with Git</h3>
      <p className="setting-said backup-protects">
        {protectLead(PROTECTS.git, 2)} <LearnMore>{protectRest(PROTECTS.git, 2)}</LearnMore>
      </p>
      <Row title="Git backup" hint={g.git === 'missing' ? 'Git isn’t on this PC. Install Git for Windows.' : g.git === 'host' ? 'Uses the Git that came with this app.' : 'Uses Git on this PC.'}>
        <Toggle label="Git backup" value={g.prefs.on} onChange={(on) => void act(() => window.nv.backup.git({ on }), on ? 'Backing up now, then whenever notes change.' : 'The Git backup is off. The history stays in the notes folder.')} />
      </Row>
      {g.prefs.on && (
        <>
          <Row title="When notes change" hint="A backup is made only when something changed since the last one.">
            <Every label="How often to back up" value={g.prefs.minutes} onChange={(minutes) => void act(() => window.nv.backup.git({ minutes }))} />
          </Row>
          <Row title="Remote" hint="An empty private repository (its HTTPS address from the Clone button), an ssh address, or a folder on a NAS or USB drive. Leave it empty to keep the history on this PC only." stacked>
            <div className="field-row">
              <input className="setting-input" style={{ width: 360 }} value={remote} placeholder="https://github.com/you/notes-backup.git" spellCheck={false} onChange={(e) => setRemote(e.target.value)} />
              <button className="button" disabled={busy || remote.trim() === g.prefs.remote} onClick={() => void act(() => window.nv.backup.git({ remote: remote.trim() }), remote.trim() ? 'Saved. The next backup copies the history there.' : 'The history stays on this PC only.')}>
                Save
              </button>
            </div>
          </Row>
          {https && (
            <Row title="Signing in" hint={g.prefs.signIn === 'neuralspark' ? 'With the Git accounts already signed in on this PC.' : g.tokenSaved ? 'A token is saved, encrypted by Windows. Type a new one to replace it.' : 'A personal access token that may write to the repository. It’s kept encrypted by Windows and never shown again.'} stacked>
              <div className="backup-signin">
                {g.hostSignIn && (
                  <div className="segmented small">
                    <button className={g.prefs.signIn === 'neuralspark' ? 'active' : ''} onClick={() => void act(() => window.nv.backup.git({ signIn: 'neuralspark' }))}>
                      This PC’s Git sign-in
                    </button>
                    <button className={g.prefs.signIn === 'token' ? 'active' : ''} onClick={() => void act(() => window.nv.backup.git({ signIn: 'token' }))}>
                      A token
                    </button>
                  </div>
                )}
                {(g.prefs.signIn === 'token' || !g.hostSignIn) && (
                  <div className="field-row">
                    <input className="setting-input" style={{ width: 150 }} value={user} placeholder="User name" autoComplete="off" spellCheck={false} onChange={(e) => setUser(e.target.value)} />
                    <input className="setting-input" style={{ width: 220 }} type="password" value={token} placeholder={g.tokenSaved ? 'Token saved' : 'Token'} autoComplete="off" spellCheck={false} onChange={(e) => setToken(e.target.value)} />
                    <button
                      className="button"
                      disabled={busy || (!token.trim() && user.trim() === g.prefs.user)}
                      onClick={() =>
                        void act(async () => {
                          const v = await window.nv.backup.gitToken(token.trim() || '', user.trim());
                          setToken('');
                          return v;
                        }, 'Saved.')
                      }
                    >
                      Save
                    </button>
                    {g.tokenSaved && (
                      <button className="icon-button small" title="Forget the saved token" onClick={() => void act(() => window.nv.backup.gitToken(''), 'The token is forgotten on this PC.')}>
                        <Icon name="trash" size={13} />
                      </button>
                    )}
                  </div>
                )}
              </div>
            </Row>
          )}
          <Row
            title="Last backup"
            hint={
              <>
                <Status busy={g.busy} lastOk={g.lastOk} words={g.words} error={g.error} working="Backing up…" />
                {g.commits > 0 && <span className="capture-status">{`${g.commits} ${g.commits === 1 ? 'version' : 'versions'} in the history. A note’s versions are in Earlier versions.`}</span>}
              </>
            }
          >
            <button className="button" disabled={busy || g.busy || g.git === 'missing'} onClick={() => void act(() => window.nv.backup.gitNow())}>
              <Icon name="refresh" size={14} /> Back up now
            </button>
          </Row>
        </>
      )}

      <h3>Encrypted sync folder</h3>
      <p className="setting-said backup-protects">
        {protectLead(PROTECTS.sync, 1)} <LearnMore>{protectRest(PROTECTS.sync, 1)}</LearnMore>
      </p>
      {s.prefs.folder ? (
        <>
          <Row title="Folder" hint={s.prefs.folder}>
            <button className="button" disabled={busy} onClick={() => void act(() => window.nv.backup.forgetSync(), 'This PC no longer syncs with that folder. The encrypted copy stays there.')}>
              Stop using it
            </button>
          </Row>
          <Row title="Sync" hint={s.passphraseSaved ? 'Both ways: changes here go there, changes from your other PCs come here.' : 'The passphrase isn’t saved on this PC: choose the folder again and type it.'}>
            <Toggle label="Sync" value={s.prefs.on} onChange={(on) => void act(() => window.nv.backup.sync({ on }))} />
          </Row>
          {s.prefs.on && (
            <Row title="When notes change" hint="Checked this often; nothing is copied when nothing changed.">
              <Every label="How often to sync" value={s.prefs.minutes} onChange={(minutes) => void act(() => window.nv.backup.sync({ minutes }))} />
            </Row>
          )}
          <Row
            title="Last sync"
            hint={
              <>
                <Status busy={s.busy} lastOk={s.lastOk} words={s.words} error={s.error} working="Syncing…" />
                {s.lastOk > 0 && <span className="capture-status">{`${s.files} ${s.files === 1 ? 'file' : 'files'} in the encrypted copy.`}</span>}
                {s.conflicts > 0 && <span className="capture-status warn">{`A note changed on two PCs at once: both versions are kept, the other PC’s named “(conflict, …)”. Keep the one you want and delete the other.`}</span>}
              </>
            }
          >
            <button className="button" disabled={busy || s.busy || !s.passphraseSaved} onClick={() => void act(() => window.nv.backup.syncNow())}>
              <Icon name="refresh" size={14} /> Sync now
            </button>
          </Row>
        </>
      ) : (
        <Row title="Folder" hint={folder ? folder.folder : 'A folder outside your notes: in OneDrive or Dropbox, on a NAS, or on a USB drive. One folder per vault.'}>
          <button className="button" disabled={busy} onClick={() => void pickFolder()}>
            <Icon name="folderOpen" size={14} /> Choose a folder…
          </button>
        </Row>
      )}
      {folder && (
        <Row title={folder.existing ? 'Passphrase for this copy' : 'Choose a passphrase'} hint={folder.existing ? 'This folder already holds an encrypted copy (from another PC). Type the passphrase it was set up with.' : 'At least 10 characters; a few words you’ll remember is best. It can’t be reset: without it the copy can’t be opened.'} stacked>
          <div className="field-row">
            <input className="setting-input" type="password" style={{ width: 200 }} value={pass} placeholder="Passphrase" autoComplete="new-password" onChange={(e) => setPass(e.target.value)} />
            {!folder.existing && <input className="setting-input" type="password" style={{ width: 200 }} value={again} placeholder="Type it again" autoComplete="new-password" onChange={(e) => setAgain(e.target.value)} />}
            <button className="button primary" disabled={busy || pass.length < 10 || (!folder.existing && !again)} onClick={() => void setUpSync()}>
              {folder.existing ? 'Open and sync' : 'Set up'}
            </button>
            <button className="button" disabled={busy} onClick={() => setFolder(null)}>
              Cancel
            </button>
          </div>
        </Row>
      )}
      {said && <p className="setting-said">{said}</p>}
      <PortableExportSettings />
      <VaultTidySettings />
    </>
  );
}
