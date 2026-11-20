// Big files coming in (Wave 4 part c, 24 Oct 2026; src/main/vault-files.ts): each with how far it has got, paused by a
// break or a restart and carrying on by itself (a file from this PC), stopped or cancelled by the person. Shown in a
// small card at the bottom right while any are going, out of the way of the page.

import { Icon } from './Icon';
import { importWords, useImports } from '../state/vaultFiles';
import { showError } from '../state/store';

export function ImportsStrip() {
  const { list } = useImports();
  if (!list.length) return null;
  return (
    <aside className="imp" aria-label="Files coming in" aria-live="polite">
      <header className="imp-head">
        <Icon name="download" size={13} />
        <span>
          {list.length === 1 ? 'A big file is coming in' : `${list.length} big files are coming in`}
        </span>
      </header>
      <ul className="imp-list">
        {list.map((s) => {
          const pct = s.size ? Math.min(100, Math.floor((s.received / s.size) * 100)) : 0;
          return (
            <li key={s.id} className={`imp-row is-${s.state}`}>
              <div className="imp-top">
                <span className="imp-name" title={s.rel ?? s.name}>
                  {s.name}
                </span>
                <span className="imp-actions">
                  {s.state === 'running' && (
                    <button type="button" className="fc-mini" onClick={() => void window.nv.vfiles.importStop(s.id, false).catch(showError)}>
                      Pause
                    </button>
                  )}
                  {(s.state === 'paused' || s.state === 'failed') && s.from === 'path' && (
                    <button type="button" className="fc-mini" onClick={() => void window.nv.vfiles.importResume(s.id).catch(showError)}>
                      Carry on
                    </button>
                  )}
                  <button type="button" className="fc-mini" title="Stop and take away what has come in so far" onClick={() => void window.nv.vfiles.importStop(s.id, true).catch(showError)}>
                    Cancel
                  </button>
                </span>
              </div>
              <div className="imp-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${s.name}: ${pct}%`}>
                <span style={{ width: `${pct}%` }} />
              </div>
              <div className="imp-words">{importWords(s)}</div>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
