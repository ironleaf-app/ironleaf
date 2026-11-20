// Ironleaf's updates in the window (20 Nov 2026, standalone): a small notice at the bottom right driven by
// src/main/update-check.ts — "Version X is available" with its notes and Update; the download's progress in MB;
// "Restart to update" once it is downloaded and checked; "Updated to X" with the notes on the first start of the
// new version; and, when an install did not land, what went wrong with the website as the fallback. Plus the two
// links to Settings › About and updates (components/about), where the switches, the notes and the history are; and
// the tray's and the Help menu's requests to open that page are heard here. Everything reads window.nvUpdate (src/preload/update-check.ts) and shows nothing
// when it is not there. Own file, inline layout on the theme's tokens: no stylesheet is touched.
import { useEffect, useState, type CSSProperties } from 'react';
import type { UpdateCheckApi } from '../../../preload/update-check';
import type { UpdateState } from '../../../main/update-check';
import { openAboutPage, useAboutDoor } from './about/aboutState';

declare global {
  interface Window {
    nvUpdate?: UpdateCheckApi;
  }
}

function useUpdateState(): UpdateState | null {
  const [state, setState] = useState<UpdateState | null>(null);
  useEffect(() => {
    const api = window.nvUpdate;
    if (!api) return;
    let live = true;
    void api.state().then((s) => live && setState(s), () => {});
    const off = api.onChange((s) => live && setState(s));
    return () => {
      live = false;
      off();
    };
  }, []);
  return state;
}

const card: CSSProperties = { position: 'fixed', right: 16, bottom: 16, zIndex: 900, width: 340, maxWidth: 'calc(100vw - 32px)', padding: '12px 14px', borderRadius: 10, background: 'var(--bg-raised, var(--bg))', color: 'inherit', border: '1px solid var(--border)', boxShadow: '0 6px 24px rgba(0, 0, 0, 0.18)', fontSize: 13, lineHeight: 1.45 };
const notesStyle: CSSProperties = { margin: '6px 0 10px', maxHeight: 120, overflowY: 'auto', whiteSpace: 'pre-wrap', opacity: 0.85 };
const buttons: CSSProperties = { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10, flexWrap: 'wrap' };
const track: CSSProperties = { height: 6, borderRadius: 3, background: 'var(--border)', overflow: 'hidden', margin: '8px 0 4px' };

const mb = (n: number) => (n / 1048576).toFixed(n >= 10 * 1048576 ? 0 : 1);

/** The words for where the update is up to (exported for the Settings row and the checks). */
export function updateWords(state: UpdateState): string {
  const a = state.available;
  if (state.updated && state.stage === 'idle') return `Updated to ${state.updated.version}.`;
  if (!a) return '';
  if (state.stage === 'downloading' && state.progress) return `Downloading Ironleaf ${a.version}… ${mb(state.progress.received)} of ${mb(state.progress.total)} MB${state.progress.differential ? ' (only what changed)' : ''}`;
  if (state.stage === 'downloading') return `Downloading Ironleaf ${a.version}…`;
  if (state.stage === 'verifying') return 'Checking the download…';
  if (state.stage === 'ready') return `Ironleaf ${a.version} is ready. Restart to update${state.installsOnQuit ? ', or it installs when you quit' : ''}.`;
  if (state.stage === 'installing') return `Restarting to update to ${a.version}…`;
  return `Version ${a.version} is available.`;
}

export function UpdateBanner() {
  useAboutDoor();
  const state = useUpdateState();
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState('');
  if (!state) return null;
  const api = window.nvUpdate!;
  const act = (fn: () => Promise<unknown>) => {
    setBusy(true);
    void fn().then(() => setBusy(false), () => setBusy(false));
  };
  const site = (
    <button type="button" className="button" disabled={busy} onClick={() => act(() => api.openPage())}>
      Download from the website
    </button>
  );

  // The first start after an update: it landed. (A newer update already on its way shows instead.)
  if (state.updated && state.stage === 'idle') {
    return (
      <div role="status" aria-live="polite" data-update-banner="updated" style={card}>
        <div style={{ fontWeight: 600 }}>Updated to {state.updated.version}</div>
        {state.updated.from && <div style={{ opacity: 0.7 }}>From {state.updated.from}. Everything is where you left it.</div>}
        {state.updated.notes && <div style={notesStyle}>{state.updated.notes}</div>}
        <button type="button" className="link-button" onClick={() => openAboutPage({ focus: 'whats-new' })}>
          See the full version history
        </button>
        <div style={buttons}>
          <button type="button" className="button primary" disabled={busy} onClick={() => act(() => api.dismissNotice())}>
            OK
          </button>
        </div>
      </div>
    );
  }
  // The last install did not land: this version still works; the website is the other way.
  if (state.failed && state.stage === 'idle') {
    return (
      <div role="alert" data-update-banner="failed" style={card}>
        <div style={{ fontWeight: 600 }}>Ironleaf {state.failed.version} could not be installed</div>
        <div style={{ ...notesStyle, color: 'var(--danger)' }}>{state.failed.words}</div>
        <div style={{ opacity: 0.8 }}>You are still on {state.current}, which works as before.</div>
        <div style={buttons}>
          <button type="button" className="button" disabled={busy} onClick={() => act(() => api.dismissNotice())}>
            Close
          </button>
          {site}
          {state.available?.canInstall && (
            <button type="button" className="button primary" disabled={busy} onClick={() => act(() => api.download())}>
              Try again
            </button>
          )}
        </div>
      </div>
    );
  }

  const a = state.available;
  // Announced but not on the site yet: nothing the person can do now, so no banner (About says so, and the next
  // check tries again by itself).
  if (!a || state.missing || (a.dismissed && state.stage === 'idle' && !state.error) || hidden === `${a.version}:${state.stage}`) return null;
  const pct = state.progress && state.progress.total ? Math.min(100, Math.round((state.progress.received / state.progress.total) * 100)) : 0;
  const later = (
    <button type="button" className="button" disabled={busy} onClick={() => (state.stage === 'idle' ? act(() => api.dismiss()) : setHidden(`${a.version}:${state.stage}`))}>
      Later
    </button>
  );
  return (
    <div role="status" aria-live="polite" data-update-banner={state.stage} style={card}>
      <div style={{ fontWeight: 600 }}>{state.stage === 'ready' ? `Ironleaf ${a.version} is ready` : state.stage === 'idle' ? `Version ${a.version} is available` : `Updating to ${a.version}`}</div>
      <div style={{ opacity: 0.7 }}>You have {state.current}.</div>
      {(state.stage === 'downloading' || state.stage === 'verifying') && (
        <>
          <div style={track} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={state.stage === 'verifying' ? 100 : pct}>
            <div style={{ width: `${state.stage === 'verifying' ? 100 : pct}%`, height: '100%', background: 'var(--accent)', transition: 'width 0.2s' }} />
          </div>
          <div style={{ opacity: 0.8 }} data-update-progress>
            {updateWords(state)}
          </div>
        </>
      )}
      {state.stage !== 'downloading' && state.stage !== 'verifying' && a.notes && <div style={notesStyle}>{a.notes}</div>}
      <button type="button" className="link-button" onClick={() => openAboutPage()}>
        What’s new
      </button>
      {state.stage === 'ready' && <div style={{ opacity: 0.8 }}>{state.installsOnQuit ? 'It installs when Ironleaf restarts, or when you next quit. Your notes are saved first.' : 'Ironleaf starts again in the new version. Your notes are saved first.'}</div>}
      {state.error && <div style={{ ...notesStyle, color: 'var(--danger)' }}>{state.error}</div>}
      <div style={buttons}>
        {state.stage !== 'installing' && later}
        {state.error && site}
        {state.stage === 'idle' && (
          <button type="button" className="button primary" disabled={busy} onClick={() => act(() => api.download())}>
            {a.canInstall ? (state.error ? 'Try again' : 'Update') : 'Download'}
          </button>
        )}
        {state.stage === 'ready' && (
          <button type="button" className="button primary" disabled={busy} onClick={() => act(() => api.install())}>
            Restart to update
          </button>
        )}
      </div>
    </div>
  );
}
