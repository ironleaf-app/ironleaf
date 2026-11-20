// Settings › Backups and sync › New task shape (t238 vault rebuild step 1, 12 Nov 2026): the switch for the
// vault tidy, off until turned on. One plain "Tidy my vault into the new shape" with a preview first (a dry run:
// nothing written), then a run on a copy beside the vault — the open vault is never touched. Every changed note's
// original is kept in the copy's dated backup folder, and one command puts it all back.
import { useEffect, useState } from 'react';
import type { TidyReport } from '../../../shared/vault-tidy';
import { useEscape } from '../lib/useEscape';
import { showError, savePrefs, useApp, usePrefs } from '../state/store';
import { Row, Toggle } from './Settings';

/** The preview and the run, in one dialog: what each note becomes, then where the copy landed. */
function VaultTidyDialog({ onClose }: { onClose(): void }) {
  const canEdit = useApp((s) => s.canEdit);
  const [preview, setPreview] = useState<{ report: TidyReport; words: string } | null>(null);
  const [done, setDone] = useState<{ folder: string; backup: string | null; words: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEscape(onClose);
  useEffect(() => {
    let live = true;
    window.nv.vaultTidy.preview().then(
      (p) => live && setPreview(p),
      (e) => live && showError(e),
    );
    return () => void (live = false);
  }, []);
  const run = async () => {
    if (!preview || busy) return;
    setBusy(true);
    try {
      const r = await window.nv.vaultTidy.tidyCopy();
      setDone({ folder: r.folder, backup: r.backup, words: r.words });
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label="Tidy my vault into the new shape" style={{ maxWidth: 640 }} onMouseDown={(e) => e.stopPropagation()}>
        <h2>Tidy my vault into the new shape</h2>
        {!preview ? (
          <p className="hint">Reading what each note would become…</p>
        ) : !done ? (
          <>
            <p className="hint">One task list per project, meeting actions as the project’s tasks, questions of their own. A copy first. Your notes stay as they are until you say.</p>
            <div style={{ maxHeight: 320, overflow: 'auto', whiteSpace: 'pre-wrap' }} className="hint">
              {preview.words}
            </div>
            <div className="dialog-actions">
              <button className="button" onClick={onClose}>
                Not now
              </button>
              <button className="button primary" disabled={!canEdit || busy || !preview.report.changed} title={canEdit ? (preview.report.changed ? 'Tidy a copy beside your notes' : 'Every note is already the new shape') : 'Read-only: nothing can be tidied'} onClick={() => void run()}>
                {busy ? 'Tidying a copy…' : 'Tidy a copy'}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="hint">Tidied a copy at {done.folder}. Every changed note’s original is beside it in its dated backup folder.</p>
            <div style={{ maxHeight: 320, overflow: 'auto', whiteSpace: 'pre-wrap' }} className="hint">
              {done.words}
            </div>
            <div className="dialog-actions">
              <button className="button primary" onClick={onClose}>
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function VaultTidySettings() {
  const prefs = usePrefs();
  const [open, setOpen] = useState(false);
  return (
    <>
      <h3>New task shape</h3>
      <Row title="Tidy my vault into the new shape" hint="One task list per project, meeting actions as the project’s tasks, questions of their own. Tried on a copy first, with a preview. Your notes stay as they are until you say.">
        <Toggle label="Tidy my vault into the new shape" value={prefs.vaultTidy} onChange={(on) => void savePrefs({ vaultTidy: on }).catch(showError)} />
      </Row>
      {prefs.vaultTidy && (
        <Row title="Preview" hint="What each note would become, with counts and every line it could not place.">
          <button className="button" onClick={() => setOpen(true)}>
            Preview the tidy…
          </button>
        </Row>
      )}
      {open && <VaultTidyDialog onClose={() => setOpen(false)} />}
    </>
  );
}
