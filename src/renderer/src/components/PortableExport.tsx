// Export everything (31 Oct 2026: portable export to prove no lock-in): the Settings rows and the project's
// dialog. One zip saved where the person chooses, private notes left out unless ticked (then decrypted, only
// after unlocking, with a clear warning), a progress line with Cancel that never blocks the app.

import { useEffect, useState } from 'react';
import { INCLUDE_PRIVATE_LABEL, PRIVATE_WARNING, type PortableProgress, type PortableResult } from '../../../shared/portable-export';
import { sizeWords } from '../../../shared/vault-place';
import { errorMessage } from '../lib/errors';
import { useEscape } from '../lib/useEscape';
import * as A from '../state/actions';
import { showError } from '../state/store';
import { Icon } from './Icon';
import { Row, Toggle } from './Settings';
import '../styles/vault-home.css';

function progressWords(p: PortableProgress | null): string {
  if (!p || !p.total) return p?.phase === 'listing' ? 'Listing your notes…' : 'Packing…';
  return `Packing ${sizeWords(p.done)} of ${sizeWords(p.total)}`;
}

function usePortable(project?: { path: string; name: string }) {
  const [includePrivate, setIncludePrivate] = useState(false);
  const [working, setWorking] = useState(false);
  const [progress, setProgress] = useState<PortableProgress | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [file, setFile] = useState<string | null>(null);
  // Unlock offered by the bridge's machine flag (9.2 uplift F135), never by matching the failure's words.
  const [unlock, setUnlock] = useState(false);

  useEffect(() => window.nv.portable.onProgress((p) => setProgress((prev) => (working ? p : prev))), [working]);

  const run = async () => {
    if (working) return;
    setWorking(true);
    setProgress(null);
    setSaid(null);
    setFailed(false);
    setFile(null);
    setUnlock(false);
    try {
      const done: PortableResult | null = project ? await window.nv.portable.exportProject(project.path, { includePrivate }) : await window.nv.portable.exportAll({ includePrivate });
      if (done) {
        setSaid(done.words);
        setFile(done.file);
      } else setSaid(null);
    } catch (err) {
      const words = errorMessage(err);
      if (words === 'Export cancelled') setSaid('Cancelled. Nothing was saved.');
      else {
        setSaid(words);
        setFailed(true);
        setUnlock(typeof err === 'object' && err !== null && (err as { needUnlock?: boolean }).needUnlock === true);
      }
    } finally {
      setWorking(false);
      setProgress(null);
    }
  };
  const cancel = () => void window.nv.portable.cancel().catch(() => undefined);
  return { includePrivate, setIncludePrivate, working, progress, said, failed, file, unlock, setSaid, run, cancel };
}

/** Settings › Backups and sync › Export everything: the rows, the warning, the progress line with Cancel. */
export function PortableExportSettings() {
  const e = usePortable();
  return (
    <>
      <h3>Take your notes with you</h3>
      <p className="setting-said backup-protects">One zip file with every note as Markdown, every picture and file beside its note, tables of your projects, tasks, meetings, people and packs, and a guide to opening them in any other app. Private notes, secrets and health records stay out unless you include them.</p>
      <Row title="Export everything" hint="Saved where you choose, starting in Downloads. Big vaults take a while; the app stays usable.">
        <button className="button" disabled={e.working} onClick={() => void e.run()}>
          <Icon name="download" size={14} /> Export everything…
        </button>
      </Row>
      <Row title={INCLUDE_PRIVATE_LABEL} hint={e.includePrivate ? PRIVATE_WARNING : 'Private notes as plain words, secrets with their values, and health records. Only after unlocking.'}>
        <Toggle label={INCLUDE_PRIVATE_LABEL} value={e.includePrivate} onChange={e.setIncludePrivate} />
      </Row>
      {e.working && (
        <div className="vp-progress" aria-live="polite" style={{ margin: '8px 0' }}>
          <div className="vp-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={e.progress && e.progress.total ? Math.round((e.progress.done / e.progress.total) * 100) : 0}>
            <span style={{ width: `${e.progress && e.progress.total ? Math.max(2, (e.progress.done / e.progress.total) * 100) : 2}%` }} />
          </div>
          <div className="field-row" style={{ marginTop: 8 }}>
            <p className="vp-phase" style={{ margin: 0 }}>{progressWords(e.progress)}</p>
            <button className="button" onClick={e.cancel}>Cancel</button>
          </div>
        </div>
      )}
      {e.said && (
        <p className={`setting-said${e.failed ? ' backup-error' : ''}`}>
          {e.said}
          {e.file && (
            <>
              {' '}
              <button type="button" className="link-button" onClick={() => void window.nv.exports.reveal(e.file!).catch(showError)}>Show in folder</button>
            </>
          )}
          {e.unlock && (
            <>
              {' '}
              <button type="button" className="link-button" onClick={() => A.openLocked('notes')}>Open Locked</button>
            </>
          )}
        </p>
      )}
    </>
  );
}

/** A project's Export this project: the same shape for one project (its notes, files, tables and guide). */
export function PortableExportDialog({ path, name, onClose }: { path: string; name: string; onClose(): void }) {
  const e = usePortable({ path, name });
  useEscape(() => !e.working && onClose());
  return (
    <div className="overlay" onMouseDown={() => !e.working && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={`Export ${name}`} onMouseDown={(ev) => ev.stopPropagation()}>
        <h2>Export this project</h2>
        {!e.said && !e.working && (
          <>
            <p className="dialog-message">Save “{name}” in one zip file: its note, its folder, its files, tables of its tasks and records, and a guide to opening them in any other app. Saved where you choose, starting in Downloads.</p>
            <label className="check-line">
              <input type="checkbox" checked={e.includePrivate} onChange={(ev) => e.setIncludePrivate(ev.target.checked)} /> {INCLUDE_PRIVATE_LABEL}
            </label>
            {e.includePrivate && <p className="dialog-message vp-failed">{PRIVATE_WARNING}</p>}
            {!e.includePrivate && <p className="hint">Private notes, secrets and health records stay out of a project export.</p>}
            <div className="dialog-actions">
              <button className="button" onClick={onClose}>Cancel</button>
              <button className="button primary" onClick={() => void e.run()}>Choose where to save it…</button>
            </div>
          </>
        )}
        {e.working && (
          <div className="vp-progress" aria-live="polite">
            <div className="vp-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={e.progress && e.progress.total ? Math.round((e.progress.done / e.progress.total) * 100) : 0}>
              <span style={{ width: `${e.progress && e.progress.total ? Math.max(2, (e.progress.done / e.progress.total) * 100) : 2}%` }} />
            </div>
            <p className="vp-phase">{progressWords(e.progress)}</p>
            <div className="dialog-actions">
              <button className="button" onClick={e.cancel}>Cancel</button>
            </div>
          </div>
        )}
        {e.said && !e.working && (
          <>
            <p className={`dialog-message${e.failed ? ' vp-failed' : ''}`}>{e.said}</p>
            <div className="dialog-actions">
              {e.file && <button className="button" onClick={() => void window.nv.exports.reveal(e.file!).catch(showError)}>Show in folder</button>}
              <button className="button primary" onClick={onClose}>Done</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
