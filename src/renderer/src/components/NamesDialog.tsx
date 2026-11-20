// Names Windows cannot keep (Nov 2026 break audit): some file or folder names Windows refuses (a dot or a space at
// the end, a name it keeps for itself, characters it refuses). Nothing is renamed until the person chooses: the bell
// asks once, naming the files, this shows the whole plan, and one Undo puts an applied plan back.

import { useEffect, useState } from 'react';
import { useEscape } from '../lib/useEscape';
import { showError, toast } from '../state/store';

interface Preview {
  pairs: [string, string][];
  notes: string[];
  decided: 'approved' | 'declined' | null;
}

const folderOf = (rel: string) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '');
const baseOf = (rel: string) => rel.split('/').pop() ?? rel;

export function NamesDialog({ onClose }: { onClose(): void }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  useEscape(() => {
    if (!busy) onClose();
  });
  useEffect(() => {
    let alive = true;
    window.nv.names
      .preview()
      .then((p) => alive && setPreview(p))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);
  const n = preview?.pairs.length ?? 0;
  const repair = () => {
    setBusy(true);
    void window.nv.names
      .repair()
      .then((words) => {
        onClose();
        toast(words, { label: 'Undo', run: () => void window.nv.names.undo().then((w) => toast(w), showError) }, 12000);
      })
      .catch((err) => {
        setBusy(false);
        showError(err);
      });
  };
  const leave = () => {
    setBusy(true);
    void window.nv.names
      .leave()
      .then((words) => {
        onClose();
        toast(words);
      })
      .catch((err) => {
        setBusy(false);
        showError(err);
      });
  };
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="dlg nm-dialog" role="dialog" aria-label="Names Windows can't open" style={{ width: 640 }}>
        <h2>{n === 1 ? '1 name Windows can’t open' : `${n} names Windows can’t open`}</h2>
        <p className="vsub">Windows refuses these names, so it cannot open them. Renaming keeps every word: only the name changes, and every link, board and record follows it.</p>
        {failed ? (
          <p className="vsub">The plan wouldn’t load. Try again.</p>
        ) : !preview ? (
          <p className="vsub">Loading the plan…</p>
        ) : (
          <>
            {preview.pairs.length > 0 && (
              <div className="nm-list" role="list" aria-label="Renames">
                {preview.pairs.map(([from, to]) => (
                  <div key={from} className="nm-row" role="listitem">
                    <span className="nm-old">
                      {folderOf(from) && <span className="nm-folder">{folderOf(from)}/</span>}
                      {baseOf(from)}
                    </span>
                    <span className="nm-arrow" aria-hidden="true">→</span>
                    <span className="nm-new">{baseOf(to)}</span>
                  </div>
                ))}
              </div>
            )}
            {preview.notes.length > 0 && (
              <div className="nm-notes" aria-label="Left alone">
                {preview.notes.map((line, i) => (
                  <p key={i} className="vsub nm-note">{line}</p>
                ))}
              </div>
            )}
            {preview.pairs.length === 0 && preview.notes.length === 0 && <p className="vsub">Nothing waits. Every name opens on Windows.</p>}
          </>
        )}
        <div className="dialog-actions">
          <button className="btn quiet" disabled={busy || !preview} onClick={leave}>Leave them</button>
          <button className="btn pri" disabled={busy || !preview || n === 0} onClick={repair} autoFocus>{busy ? 'Renaming…' : 'Rename them'}</button>
        </div>
      </div>
    </div>
  );
}
