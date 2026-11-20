// Tidy (29 Oct 2026): the preview the person approves before anything moves. What moves goes to the project's
// History note; nothing is ever deleted, and what only the person can settle is listed, never changed. The plan
// comes from the main side (src/shared/project-tidy.ts), and Tidy itself runs on the version the preview showed.

import { useEffect, useState } from 'react';
import type { TidyPreview, TidyResult } from '../../../../shared/types';
import { Icon } from '../../components/Icon';
import { useEscape } from '../../lib/useEscape';
import { showError } from '../../state/store';

const moveLines = (p: TidyPreview) => p.moves.reduce((n, m) => n + m.text.split('\n').filter((l) => l.trim()).length, 0);

function SaidList({ said }: { said: string[] }) {
  if (!said.length) return null;
  return (
    <div className="tidy-said">
      <h3>Only you can settle these</h3>
      <p className="hint">Tidy leaves these exactly as they are.</p>
      <ul>
        {said.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ul>
    </div>
  );
}

/** One project's preview: what moves where, the said list, Tidy and Cancel. */
export function TidyDialog({ path, onClose, onTidied }: { path: string; onClose(): void; onTidied(r: TidyResult): void }) {
  const [preview, setPreview] = useState<TidyPreview | null>(null);
  const [busy, setBusy] = useState(false);
  useEscape(onClose);
  useEffect(() => {
    let live = true;
    window.nv.projects.tidyPreview(path).then((p) => live && setPreview(p), (e) => live && showError(e));
    return () => void (live = false);
  }, [path]);
  const tidy = async () => {
    if (!preview || busy) return;
    setBusy(true);
    try {
      const r = await window.nv.projects.tidy(path, preview.version);
      onTidied(r);
      onClose();
    } catch (err) {
      showError(err);
      setBusy(false);
    }
  };
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="dialog tidy-dialog" role="dialog" aria-modal="true" aria-label="Tidy this project" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Tidy this project</h2>
        {!preview ? (
          <p className="hint">Looking at what could move…</p>
        ) : (
          <>
            <p className="hint">
              Nothing is deleted. What moves goes to the project’s History note ({preview.historyPath}), newest at the top, and the whole tidy can be undone.
            </p>
            {preview.moves.length ? (
              <div className="tidy-moves">
                <h3>
                  {preview.moves.length} {preview.moves.length === 1 ? 'thing' : 'things'} move to History
                </h3>
                <ul>
                  {preview.moves.map((m, i) => (
                    <li key={i}>
                      <span className="tidy-move-words">{m.words}</span>
                      <span className="tidy-move-text">{m.text}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p>Nothing needs to move in this project just now.</p>
            )}
            <SaidList said={preview.said} />
          </>
        )}
        <div className="dialog-actions">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="button primary" disabled={!preview?.moves.length || busy} onClick={() => void tidy()}>
            <Icon name="sparkle" size={13} /> Tidy
          </button>
        </div>
      </div>
    </div>
  );
}

/** Every project's preview in one list (Today's "N projects could be tidied"): one row per project, how much moves. */
export function TidyAllDialog({ onClose, onTidied }: { onClose(): void; onTidied(done: TidyResult[]): void }) {
  const [rows, setRows] = useState<TidyPreview[] | null>(null);
  const [busy, setBusy] = useState(false);
  useEscape(onClose);
  const load = () => window.nv.projects.tidyAllPreview().then(setRows, (e) => showError(e));
  useEffect(() => void load(), []);
  const tidyAll = async () => {
    if (!rows || busy) return;
    setBusy(true);
    const done: TidyResult[] = [];
    try {
      for (const row of rows) done.push(await window.nv.projects.tidy(row.path, row.version));
      onTidied(done);
      onClose();
    } catch (err) {
      showError(err);
      if (done.length) onTidied(done);
      void load();
      setBusy(false);
    }
  };
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="dialog tidy-dialog" role="dialog" aria-modal="true" aria-label="Tidy all projects" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Projects that could be tidied</h2>
        <p className="hint">Nothing is deleted. What moves goes to each project’s History note, and the whole tidy can be undone.</p>
        {!rows ? (
          <p className="hint">Looking at your projects…</p>
        ) : rows.length ? (
          <ul className="tidy-all">
            {rows.map((r) => (
              <li key={r.path}>
                <span className="tidy-all-name">{r.name}</span>
                <span className="tidy-all-count">
                  {r.moves.length} {r.moves.length === 1 ? 'thing' : 'things'} move ({moveLines(r)} lines)
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p>Every project is tidy just now.</p>
        )}
        {!!rows?.length && <SaidList said={[...new Set(rows.flatMap((r) => r.said.map((s) => `${r.name}: ${s}`)))]} />}
        <div className="dialog-actions">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="button primary" disabled={!rows?.length || busy} onClick={() => void tidyAll()}>
            <Icon name="sparkle" size={13} /> Tidy all
          </button>
        </div>
      </div>
    </div>
  );
}
