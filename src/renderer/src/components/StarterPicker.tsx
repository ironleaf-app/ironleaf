// Starting from a template (8.8): the ten starters in one picker. Pick one, name its folder, and its notes, records
// and saved views are made and opened (state/starterTemplates.ts). Reached from Home, Projects, Notes and the palette.

import { useCallback, useEffect, useRef, useState } from 'react';
import { STARTER_TEMPLATES, starterById, starterFiles } from '../../../shared/starter-templates';
import { useEscape } from '../lib/useEscape';
import { showError } from '../state/store';
import { startStarter, todayIso } from '../state/starterTemplates';

export function StarterPicker({ template, onClose }: { template?: string; onClose(): void }) {
  const first = starterById(template ?? '') ?? STARTER_TEMPLATES[0];
  const [picked, setPicked] = useState(first.id);
  const [folder, setFolder] = useState(first.folder);
  const [busy, setBusy] = useState(false);
  const current = starterById(picked) ?? first;
  // Escape puts it away, except while it is making (the same guard as clicking out).
  const close = useCallback(() => {
    if (!busy) onClose();
  }, [busy, onClose]);
  useEscape(close);
  // The list is the keyboard's way through the ten: arrows move with the focus (which brings a row scrolled out of
  // sight back into view), wrapping like the pickers; Home and End jump. The folder box keeps its own arrows.
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current?.querySelector<HTMLButtonElement>('.st-row.is-picked')?.focus();
  }, []);
  const move = (to: number) => {
    const n = STARTER_TEMPLATES[(to + STARTER_TEMPLATES.length) % STARTER_TEMPLATES.length];
    setPicked(n.id);
    setFolder(n.folder);
    requestAnimationFrame(() => list.current?.querySelector<HTMLButtonElement>(`[data-starter="${n.id}"]`)?.focus());
  };
  const at = STARTER_TEMPLATES.findIndex((t) => t.id === picked);
  // The count comes from the same file list Start writes (9.2 uplift F122): same function, same inputs, never a
  // separate sample that can drift.
  const files = (id: string) => starterFiles(id, folder || current.folder, todayIso()).length;
  const start = () => {
    setBusy(true);
    void startStarter(picked, folder || current.folder).then(onClose, (err) => {
      setBusy(false);
      showError(err);
    });
  };
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="dlg st-picker" role="dialog" aria-label="Start from a template" style={{ width: 680 }}>
        <h2>Start from a template</h2>
        <p className="vsub">Each makes real notes, records and saved views in a folder you name, then opens it.</p>
        <div
          className="st-list"
          ref={list}
          role="radiogroup"
          aria-label="Templates"
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              move(at + 1);
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              move(at - 1);
            } else if (e.key === 'Home') {
              e.preventDefault();
              move(0);
            } else if (e.key === 'End') {
              e.preventDefault();
              move(STARTER_TEMPLATES.length - 1);
            }
          }}
        >
          {STARTER_TEMPLATES.map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              data-starter={t.id}
              aria-checked={picked === t.id}
              className={`trow st-row${picked === t.id ? ' is-picked' : ''}`}
              onClick={() => {
                setPicked(t.id);
                setFolder(t.folder);
              }}
            >
              <span className="ab-open">
                <span className="t clip">{t.name}</span>
                <span className="meta clip">{t.words}</span>
              </span>
              <span className="meta" style={{ marginLeft: 'auto' }}>{files(t.id)} files</span>
            </button>
          ))}
        </div>
        <label className="st-folder">
          <span>Folder</span>
          <input value={folder} onChange={(e) => setFolder(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !busy && start()} placeholder={current.folder} aria-label="Folder name" spellCheck={false} />
        </label>
        <div className="dialog-actions">
          <button className="btn quiet" disabled={busy} onClick={onClose}>Cancel</button>
          <button className="btn pri" disabled={busy || !folder.trim()} onClick={start}>{busy ? 'Making…' : `Start ${current.name}`}</button>
        </div>
      </div>
    </div>
  );
}
