// The move of the flat attachments folder into place, reviewed before anything moves (Wave 4 part c, 24 Oct 2026;
// src/main/vault-files.ts). Each file says where it goes and why (the note that links to it, names it, or shares its
// name), and can be sent to another note or left where it is; the files nothing names stay and say so. Then the move:
// a safety copy first, every link brought up to date, the files and links checked, and Undo.

import { useEffect, useMemo, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { fileMigrationWords, kindWords, sizeWords, type FileMovePlan } from '../../../shared/file-records';
import type { MigrationResult } from '../../../shared/vault-files-api';
import { fuzzyFilter } from '../lib/fuzzy';
import { errorMessage } from '../lib/errors';
import { getState, showError, toast } from '../state/store';
import { Icon } from './Icon';
import { pick } from './Pickers';

const titleOf = (p: string) => (p.split('/').pop() ?? p).replace(/\.(md|canvas)$/i, '');
const SURE: Record<FileMovePlan['sure'], { icon: 'check' | 'help' | 'info'; tone: string }> = { linked: { icon: 'check', tone: 'ok' }, named: { icon: 'check', tone: 'ok' }, guess: { icon: 'help', tone: 'warn' }, none: { icon: 'info', tone: 'none' } };

let host: { el: HTMLDivElement; root: Root } | null = null;

export function openFilesMove(): void {
  if (!host) {
    const el = document.createElement('div');
    document.body.appendChild(el);
    host = { el, root: createRoot(el) };
  }
  const close = () => host?.root.render(null);
  host.root.render(<FilesMove key={Date.now()} onClose={close} />);
}

/** A note to send a file to: any note in the vault (templates left out). */
export async function chooseNote(file: string, placeholder?: string): Promise<string | null> {
  const notes = getState().notes.filter((n) => !/^templates\//i.test(n.path));
  return pick({
    placeholder: placeholder ?? `Which note does ${file.split('/').pop()} belong with?`,
    items: (q) =>
      fuzzyFilter(notes, q, (n) => `${n.label} ${n.path}`)
        .slice(0, 60)
        .map((n) => ({ id: n.path, label: n.label, detail: n.path.includes('/') ? n.path.slice(0, n.path.lastIndexOf('/')) : '', icon: 'file' as const })),
    footer: '↑↓ to move · Enter to choose · Esc to cancel',
  });
}

function FilesMove({ onClose }: { onClose(): void }) {
  const [plan, setPlan] = useState<FileMovePlan[] | null>(null);
  const [folder, setFolder] = useState('Attachments');
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<MigrationResult | null>(null);
  const [undone, setUndone] = useState('');
  useEffect(() => {
    window.nv.vfiles.migrationPlan().then(
      (r) => {
        setPlan(r.plan);
        setFolder(r.folder);
      },
      (e) => setProblem(errorMessage(e)),
    );
    // Esc closes this first (before the peek or the page under it hear it).
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      if (!busy) onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  // The plan with the person's choices on it, for the words and the counts.
  const shown = useMemo(() => {
    if (!plan) return [];
    return plan.map((p) => {
      if (!(p.from in choices)) return p;
      const rec = choices[p.from];
      if (!rec) {
        const { to: _t, record: _r, ...rest } = p;
        return { ...rest, why: 'You chose to leave it where it is.' } as FileMovePlan;
      }
      return { ...p, record: rec, to: `${rec}`, sure: 'linked', why: 'You chose it' } as FileMovePlan;
    });
  }, [plan, choices]);
  const going = shown.filter((p) => p.to);
  const staying = shown.filter((p) => !p.to);

  const apply = async () => {
    setBusy(true);
    try {
      const r = await window.nv.vfiles.migrationApply(choices);
      setDone(r);
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };
  const undo = async () => {
    setBusy(true);
    try {
      const r = await window.nv.vfiles.migrationUndo();
      setUndone(r.words + (r.problems.length ? ` ${r.problems.join(' ')}` : ''));
      toast(r.words);
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fm-scrim" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="fm" role="dialog" aria-label="Files beside their notes">
        <header className="fm-head">
          <span className="fm-head-icon" aria-hidden="true">
            <Icon name="files" size={18} />
          </span>
          <div className="fm-head-words">
            <h2>Files beside their notes</h2>
            <p>
              {done
                ? done.words
                : plan
                  ? `${fileMigrationWords(shown)} Each goes into a Files folder beside the note it belongs with, and every link to it keeps working.`
                  : problem || `Reading ${folder}…`}
            </p>
          </div>
          <button type="button" className="peek-icon-button" aria-label="Close" disabled={busy} onClick={onClose}>
            <Icon name="close" size={14} />
          </button>
        </header>

        {!done && plan && (
          <div className="fm-body">
            {!plan.length && <p className="fm-empty">There’s nothing in {folder} to move. New files already go beside their notes.</p>}
            {going.length > 0 && (
              <section className="fm-group">
                <h3>
                  Going beside their notes <span className="fm-count">{going.length}</span>
                </h3>
                <ul className="fm-list">
                  {going.map((p) => (
                    <Row key={p.from} p={p} onChange={(rec) => setChoices((c) => ({ ...c, [p.from]: rec }))} />
                  ))}
                </ul>
              </section>
            )}
            {staying.length > 0 && (
              <section className="fm-group">
                <h3>
                  Staying in {folder} <span className="fm-count">{staying.length}</span>
                </h3>
                <ul className="fm-list">
                  {staying.map((p) => (
                    <Row key={p.from} p={p} onChange={(rec) => setChoices((c) => ({ ...c, [p.from]: rec }))} />
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}

        {done && (
          <div className="fm-body">
            <div className="fm-check">
              <div className={`fm-check-item${done.check.filesOk === done.check.files ? ' is-ok' : ' is-bad'}`}>
                <Icon name={done.check.filesOk === done.check.files ? 'check' : 'warning'} size={15} />
                <span>
                  <b>
                    {done.check.filesOk} of {done.check.files}
                  </b>{' '}
                  files are in their new place with the same contents
                </span>
              </div>
              <div className={`fm-check-item${done.check.linksOk === done.check.links ? ' is-ok' : ' is-bad'}`}>
                <Icon name={done.check.linksOk === done.check.links ? 'check' : 'warning'} size={15} />
                <span>
                  <b>
                    {done.check.linksOk} of {done.check.links}
                  </b>{' '}
                  links to them still reach them
                </span>
              </div>
              {done.safety && (
                <div className="fm-check-item is-ok">
                  <Icon name="lock" size={15} />
                  <span>A safety copy of everything that moved was kept first ({done.safety.split('/').pop()}).</span>
                </div>
              )}
            </div>
            {[...done.check.broken, ...done.problems].length > 0 && (
              <ul className="fm-problems">
                {[...done.check.broken, ...done.problems].map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            )}
            <ul className="fm-list is-done">
              {done.moved.map((m) => (
                <li key={m.from} className="fm-row">
                  <span className="fm-file">
                    <span className="fm-name">{m.to.split('/').pop()}</span>
                    <span className="fm-where">{m.to.split('/').slice(0, -1).join('/')}</span>
                  </span>
                </li>
              ))}
            </ul>
            {undone && <p className="fm-undone">{undone}</p>}
          </div>
        )}

        <footer className="fm-foot">
          {!done ? (
            <>
              <span className="fm-foot-note">A safety copy is kept first, and you can undo it afterwards.</span>
              <button type="button" className="peek-button" disabled={busy} onClick={onClose}>
                Not now
              </button>
              <button type="button" className="peek-button primary" disabled={busy || !going.length} onClick={() => void apply()}>
                {busy ? 'Moving…' : `Move ${going.length} ${going.length === 1 ? 'file' : 'files'}`}
              </button>
            </>
          ) : (
            <>
              <span className="fm-foot-note">New files you add go beside their notes from now on (Settings › General).</span>
              {!undone && (
                <button type="button" className="peek-button" disabled={busy} onClick={() => void undo()}>
                  <Icon name="undo" size={13} />
                  Undo the move
                </button>
              )}
              <button type="button" className="peek-button" onClick={() => void import('../state/recordsTab').then((m) => m.openRecordsView('all-files.json', 'tab')).then(onClose)}>
                See all files
              </button>
              <button type="button" className="peek-button primary" onClick={onClose}>
                Done
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}

function Row({ p, onChange }: { p: FileMovePlan; onChange(record: string): void }) {
  const sure = SURE[p.sure];
  const name = p.from.split('/').pop() ?? p.from;
  return (
    <li className="fm-row">
      <span className="fm-file">
        <span className="fm-name">{name}</span>
        <span className="fm-where">
          {kindWords(name)}
          {p.size !== undefined ? ` · ${sizeWords(p.size)}` : ''}
        </span>
      </span>
      <span className="fm-arrow" aria-hidden="true">
        <Icon name="forward" size={13} />
      </span>
      <span className="fm-dest">
        {p.record ? <span className="fm-dest-name">{titleOf(p.record)}</span> : <span className="fm-dest-name is-stay">Stays where it is</span>}
        <span className={`fm-why tone-${sure.tone}`}>
          <Icon name={sure.icon} size={11} />
          <span>{p.why}</span>
        </span>
      </span>
      <span className="fm-row-actions">
        <button type="button" className="fc-mini" onClick={() => void chooseNote(p.from).then((rec) => rec && onChange(rec))}>
          {p.record ? 'Change' : 'Choose a note…'}
        </button>
        {p.record && (
          <button type="button" className="fc-mini" title="Leave it in the attachments folder" onClick={() => onChange('')}>
            Leave it
          </button>
        )}
      </span>
    </li>
  );
}

/** A quiet line in the Files views while files still sit in the flat attachments folder. */
export function FilesMoveBanner({ count, folder }: { count: number; folder: string }) {
  if (!count) return null;
  return (
    <div className="fm-banner" role="note">
      <Icon name="files" size={15} />
      <span>
        {count} {count === 1 ? 'file is' : 'files are'} still in {folder}, not with {count === 1 ? 'its note' : 'their notes'}.
      </span>
      <button type="button" className="peek-button" onClick={openFilesMove}>
        Review the move
      </button>
    </div>
  );
}
