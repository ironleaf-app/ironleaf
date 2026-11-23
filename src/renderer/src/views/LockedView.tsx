// The one Locked place (10.0 v2locked, plan item 24): private notes and secrets under one lock. Unlock once (your
// recovery password, or Windows Hello on a PC you added, never required) and both open; lock once and both lock, with
// the same timing. Nothing outside this open page reads them: not search, the graph, the assistant, the former host
// app, bots, or any other program, even while unlocked. Set up once here; the scanner and the audit trail sit beside
// the two stores as sections. Older private and secrets tabs open this same page.

import { useCallback, useEffect, useState } from 'react';
import type { LockedStatus } from '../../../shared/secrets';
import { unlockedPhrase } from '../../../shared/prefs';
import { Icon } from '../components/Icon';
import { openMenu } from '../components/Menu';
import { errorMessage } from '../lib/errors';
import { headerOverflowHidden, overflowMenuItems } from '../lib/headerOverflow';
import { withStepUp } from '../lib/step-up';
import { openModal } from '../state/modals';
import { onLockedSection, takeLockedSection, usePrivacy, type LockedSection } from '../state/privacy';
import { lockPrivate, privateOpened, refreshPrivate, usePrivate, usePrivateWindowUse } from '../state/private';
import { showError, toast, useApp, usePrefs } from '../state/store';
import type * as W from '../state/workspace';
import { ChangePassword, PrivateNotesPane } from './PrivateView';
import { ActivityPane, ScanPane, SecretsPane } from './SecretsView';
import { ViewHeader } from './ViewHeader';
import '../styles/locked.css';

const MIN = 10;

function Mark() {
  return (
    <div className="pv-mark" aria-hidden="true">
      <Icon name="lock" size={24} />
    </div>
  );
}

function SetUp({ status, onOpened }: { status: LockedStatus; onOpened(): void }) {
  const canEdit = useApp((s) => s.canEdit);
  const prefs = usePrefs();
  const [first, setFirst] = useState('');
  const [again, setAgain] = useState('');
  const [hello, setHello] = useState(status.hello);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState('');
  const ready = first.length >= MIN && first === again;
  const go = async () => {
    setBusy(true);
    setSaid('');
    try {
      await privateOpened(await window.nv.private.setUp(first, hello && status.hello));
      toast('Locked is set up and open.');
      onOpened();
    } catch (err) {
      setSaid(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  // The gate (wide-window pass, 23 Nov 2026: a 460 px card stood alone at the top of a 2,000 px page): what Locked is,
  // on a quiet panel at the left; the one thing to do, the set-up, beside it. Narrow, the two stack.
  return (
    <div className="pv-page pv-gate">
      <div className="pv-gate-frame">
        <div className="pv-card pv-gate-side">
          <div className="pv-gate-words">
            <Mark />
            <h1>Locked</h1>
            <p className="pv-lede">One locked place for private notes and secrets. Unlock once and both open; lock once and both lock. Nothing else reads them: not search, the graph, or any other program.</p>
            <ul className="pv-points">
              <li>
                <Icon name="check" size={13} />
                {status.hello ? 'Open it with Windows Hello: your PIN, face or fingerprint.' : 'Open it with your recovery password.'}
              </li>
              <li>
                <Icon name="check" size={13} />
                On another PC, open it with your recovery password.
              </li>
              <li>
                <Icon name="check" size={13} />
                Once open, it stays open on this PC {unlockedPhrase(prefs.secretsKeepUnlocked, prefs.privateLockMinutes)}.
              </li>
            </ul>
          </div>
        </div>
        <div className="pv-gate-main">
          <form
            className="pv-gate-form"
            aria-labelledby="pv-gate-ask"
            onSubmit={(e) => {
              e.preventDefault();
              if (ready && !busy) void go();
            }}
          >
            <h2 id="pv-gate-ask" className="pv-gate-ask">Choose a recovery password</h2>
            <label className="pv-field">
              <span>Recovery password</span>
              <input type="password" autoComplete="new-password" placeholder={`At least ${MIN} characters`} value={first} onChange={(e) => setFirst(e.target.value)} autoFocus />
            </label>
            <label className="pv-field">
              <span>Type it again</span>
              <input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
              {again && first !== again && <em className="pv-field-note">The two don’t match yet.</em>}
            </label>
            {status.hello && (
              <label className="pv-check">
                <input type="checkbox" checked={hello} onChange={(e) => setHello(e.target.checked)} />
                Also open it with Windows Hello on this PC
              </label>
            )}
            <p className="pv-warn">
              <Icon name="warning" size={13} />
              <span>Keep the recovery password somewhere safe (not in a note). Without it{status.hello ? ', and without this PC’s Windows Hello,' : ','} no one can open Locked, not even us.</span>
            </p>
            {said && <p className="pv-said">{said}</p>}
            <button type="submit" className="button primary pv-go" disabled={!canEdit || !ready || busy}>
              {busy ? 'Setting up…' : 'Set up Locked'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

function Unlock({ status, onOpened }: { status: LockedStatus; onOpened(): void }) {
  const prefs = usePrefs();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<'hello' | 'password' | null>(null);
  const [said, setSaid] = useState('');
  const withHello = status.hello && status.thisPc;
  const open = async (kind: 'hello' | 'password', fn: () => Promise<unknown>) => {
    setBusy(kind);
    setSaid('');
    try {
      await fn();
      await refreshPrivate();
      onOpened();
    } catch (err) {
      setSaid(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };
  const counts = status.notes + status.secrets > 0
    ? `${status.notes} ${status.notes === 1 ? 'private note' : 'private notes'} and ${status.secrets} ${status.secrets === 1 ? 'login or key' : 'logins and keys'} are locked on this PC.`
    : 'Your private notes and secrets are locked on this PC.';
  return (
    <div className="pv-page pv-gate">
      <div className="pv-gate-frame">
        <div className="pv-card pv-gate-side">
          <div className="pv-gate-words">
            <Mark />
            <h1>Locked</h1>
            <p className="pv-lede">{counts} Nothing is sent anywhere until you unlock.</p>
          </div>
        </div>
        <div className="pv-gate-main">
          <div className="pv-gate-form">
            <h2 className="pv-gate-ask">Unlock to open them</h2>
            {withHello && (
              <button className="button primary pv-go" disabled={!!busy} onClick={() => void open('hello', () => window.nv.private.unlockWithHello())}>
                <Icon name="lock" size={14} /> {busy === 'hello' ? 'Waiting for Windows Hello…' : 'Unlock with Windows Hello'}
              </button>
            )}
            <form
              className="pv-password"
              onSubmit={(e) => {
                e.preventDefault();
                if (password && !busy) void open('password', () => window.nv.private.unlockWithPassword(password));
              }}
            >
              <input type="password" aria-label="Recovery password" autoComplete="current-password" placeholder={withHello ? 'Or your recovery password' : 'Your recovery password'} value={password} onChange={(e) => setPassword(e.target.value)} autoFocus={!withHello} />
              <button type="submit" className={`button${withHello ? '' : ' primary'}`} disabled={!password || !!busy}>
                {busy === 'password' ? 'Opening…' : 'Unlock'}
              </button>
            </form>
            {status.hello && !status.thisPc && <p className="pv-hint">This PC doesn’t open Locked with Windows Hello yet. Open it with your recovery password, then add this PC from the ⋯ menu.</p>}
            {said && <p className="pv-said">{said}</p>}
            <p className="pv-gate-note">Once unlocked, Locked stays unlocked on this PC {unlockedPhrase(prefs.secretsKeepUnlocked, prefs.privateLockMinutes)}. Unlock timing lives in Settings › Privacy and secrets.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

const SECTIONS: { id: LockedSection; label: string }[] = [
  { id: 'notes', label: 'Private notes' },
  { id: 'secrets', label: 'Secrets' },
  { id: 'scan', label: 'Find in notes' },
  { id: 'activity', label: 'Activity' },
];

export function LockedView({ tab }: { tab: W.TabState }) {
  const prefs = usePrefs();
  const canEdit = useApp((s) => s.canEdit);
  const { secretsRevision } = usePrivacy();
  const { notes } = usePrivate();
  const [status, setStatus] = useState<LockedStatus | null>(null);
  usePrivateWindowUse(!!status?.unlocked);
  const [section, setSection] = useState<LockedSection>(() => takeLockedSection() ?? (tab.type === 'secrets' ? 'secrets' : 'notes'));
  const [changing, setChanging] = useState(false);
  const [addSecret, setAddSecret] = useState<(() => void) | null>(null);
  const refresh = useCallback(() => void window.nv.locked.status().then(setStatus, showError), []);
  useEffect(() => {
    void refreshPrivate();
    refresh();
  }, [refresh, secretsRevision]);
  useEffect(() => window.nv.on.privateLocked(() => refresh()), [refresh]);
  useEffect(() => {
    // A section asked for from elsewhere also re-reads the lock: the tab may have been showing the gate.
    const off = onLockedSection((p) => (takeLockedSection(), setSection(p), refresh()));
    const asked = takeLockedSection();
    if (asked) setSection(asked);
    return off;
  }, [refresh]);
  const onAddState = useCallback((open: boolean, add: () => void) => setAddSecret(open ? add : null), []);
  const timing = `Unlocked · ${unlockedPhrase(prefs.secretsKeepUnlocked, prefs.privateLockMinutes)}`;
  const crumb = <b>Locked</b>;
  if (!status)
    return (
      <>
        <ViewHeader tab={tab} crumb={crumb} />
        <div className="pv-page"><div className="view-loading" /></div>
      </>
    );
  if (!status.exists)
    return (
      <>
        <ViewHeader tab={tab} crumb={crumb} />
        <SetUp status={status} onOpened={refresh} />
      </>
    );
  if (!status.unlocked)
    return (
      <>
        <ViewHeader tab={tab} crumb={crumb} />
        <Unlock status={status} onOpened={refresh} />
      </>
    );
  // The header contract (Round 2, 4 Nov 2026, the reviewer: nothing may ever overlap the centred search):
  // the buttons below yield one by one from the least used when measured within 12px of the bar, and this
  // menu carries exactly the hidden ones (the lock timing rides along as a marked row, so it is never lost).
  // Round 3: New secret yields last (the page's most used action).
  const more = (e: React.MouseEvent<HTMLElement>) => {
    const over = overflowMenuItems(headerOverflowHidden(tab.id), {
      'new-secret': () => ({ label: 'New secret', icon: 'plus', disabled: !canEdit, run: () => addSecret?.() }),
      'lock-now': () => ({ label: 'Lock now', icon: 'lock', run: () => void lockPrivate().then(refresh) }),
      'unlocked': () => ({ label: timing, icon: 'lock', disabled: true }),
    });
    openMenu(e.currentTarget, [
      ...over,
      ...(over.length ? [{ separator: true } as const] : []),
      ...(status.hello && !status.thisPc
        ? [{
          label: 'Open Locked with Windows Hello on this PC',
          icon: 'lock' as const,
          run: async () => {
            try {
              await privateOpened(await withStepUp(() => window.nv.private.addThisPc()));
              refresh();
              toast('This PC opens Locked with Windows Hello now.');
            } catch (err) {
              showError(err);
            }
          },
        }]
        : []),
      { label: 'Change the recovery password…', icon: 'edit' as const, run: () => setChanging(true) },
      { label: 'Who reads each level…', icon: 'settings' as const, run: () => openModal({ kind: 'settings', section: 'privacy' }) },
    ]);
  };
  const counts: Record<LockedSection, number | null> = { notes: notes.length, secrets: status.secrets, scan: null, activity: null };
  return (
    <>
      <ViewHeader tab={tab} crumb={crumb}>
        <span className="tag amber" data-overflow="unlocked" data-overflow-order={1}>{timing}</span>
        <button className="btn" data-overflow="lock-now" data-overflow-order={2} onClick={() => void lockPrivate().then(refresh)}>Lock now</button>
        {section === 'secrets' && addSecret && (
          <button className="btn pri" data-overflow="new-secret" data-overflow-order={3} disabled={!canEdit} onClick={() => addSecret()}><Icon name="plus" size={14} /> New secret</button>
        )}
        <button className="iconbtn" title="More" onClick={more}><Icon name="more" size={16} /></button>
      </ViewHeader>
      <div className="nv-page-scroll">
        <div className="nv-page">
          <h1 className="w4a-title">Locked</h1>
          <p className="vsub" style={{ margin: '4px 0 4px' }}>
            Your private notes and secrets, under one lock. Nothing else reads them: not search, the graph, or any other program.
          </p>
          {changing && <ChangePassword onDone={() => setChanging(false)} />}
          <div className="tabs sx-parts" role="tablist">
            {SECTIONS.map(({ id, label }) => (
              <button key={id} role="tab" aria-selected={section === id} className={`tab${section === id ? ' on' : ''}`} onClick={() => setSection(id)}>
                {label}
                {counts[id] !== null ? <span className="c">{counts[id]}</span> : null}
              </button>
            ))}
          </div>
          {section === 'notes' && <PrivateNotesPane notes={notes} />}
          {section === 'secrets' && <SecretsPane onChanged={refresh} onShowScan={() => setSection('scan')} onAddState={onAddState} />}
          {section === 'scan' && <ScanPane />}
          {section === 'activity' && <ActivityPane />}
        </div>
      </div>
    </>
  );
}
