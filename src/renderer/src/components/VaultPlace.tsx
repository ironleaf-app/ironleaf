// Where your notes are kept (src/main/vault-place.ts): Settings › General shows the vault's folder and where it lives
// (OneDrive, Dropbox, Google Drive, iCloud Drive, a network drive, or only this PC), with Move… and Use another folder
// as your vault…; Today shows a card once when the notes are only on this PC, and on a new PC, the vault found in a synced
// folder to open instead of the new, empty one.

import { useCallback, useEffect, useRef, useState } from 'react';
import { countWords, isRefusal, sizeWords, type FoundVault, type MoveDone, type MovePlan, type MoveProgress, type MoveRefusal, type MoveTarget, type PlaceKind, type PlaceStatus } from '../../../shared/vault-place';
import { docs } from '../state/docs';
import { saveWorkspaceNow } from '../state/layout';
import { openModal } from '../state/modals';
import { loadSettings, showError, toast, useApp } from '../state/store';
import { errorMessage } from '../lib/errors';
import { useEscape } from '../lib/useEscape';
import { Icon, type IconName } from './Icon';
import { LookRow } from './LookRow';

const api = () => window.nv.place;

/** Where the vault is, read when the vault opens or its notes change (a little after, so a burst is read once). */
export function usePlace(): { status: PlaceStatus | null; failed: boolean; refresh(fresh?: boolean): void } {
  const vaultPath = useApp((s) => s.vault?.path);
  const revision = useApp((s) => s.revision);
  const [status, setStatus] = useState<PlaceStatus | null>(null);
  // Unreadable keeps last-known and says so (9.2 uplift F129), never "Looking…" forever.
  const [failed, setFailed] = useState(false);
  const refresh = useCallback((fresh = false) => {
    void api()
      .status(fresh)
      .then(
        (s) => {
          setStatus(s);
          setFailed(false);
        },
        () => setFailed(true),
      );
  }, []);
  useEffect(() => {
    const t = setTimeout(() => refresh(), 250);
    return () => clearTimeout(t);
  }, [vaultPath, revision, refresh]);
  useEffect(() => {
    const again = () => refresh();
    window.addEventListener('nv-place-changed', again);
    return () => window.removeEventListener('nv-place-changed', again);
  }, [refresh]);
  return { status, failed, refresh };
}
const placeChanged = () => window.dispatchEvent(new Event('nv-place-changed'));

/** A long folder’s end, where its name is (…\OneDrive\Documents); the whole path on hover. */
function pathTail(p: string, max = 56): string {
  if (p.length <= max) return p;
  const sep = p.includes('\\') ? '\\' : '/';
  const parts = p.split(/[\\/]+/).filter(Boolean);
  let out = parts.pop() ?? p;
  while (parts.length && out.length + parts[parts.length - 1].length + 1 <= max - 2) out = `${parts.pop()}${sep}${out}`;
  return `…${sep}${out}`;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const kindIcon = (kind: PlaceKind): IconName => (kind === 'local' ? 'computer' : kind === 'network' ? 'server' : 'cloud');

/** Settings › General › Where your notes are kept (3 Nov 2026, audit f F23: the row and its Details named the
 *  same thing three ways; one name now, with the tip below saying when it is another folder, not the vault). */
export function VaultPlaceSection() {
  const { status, failed, refresh } = usePlace();
  useEffect(() => refresh(true), [refresh]);
  const place = status?.place;
  const other = !!status && !status.isLibrary;
  const [line, ...rest] = (place?.words ?? '').split(' — ');
  const title = !place ? (failed ? 'Couldn’t check' : 'Looking…') : place.kind === 'local' ? 'Only on this PC' : place.kind === 'network' ? line : place.name;
  return (
    <>
      <h3>Where your notes are kept</h3>
      <div className={`vp-card${place ? ` is-${place.kind === 'local' ? 'local' : place.kind === 'network' ? 'network' : 'synced'}` : ''}`} data-place={place?.kind ?? 'loading'}>
        <div className="vp-head">
          <span className="vp-mark" aria-hidden="true">
            <Icon name={place ? kindIcon(place.kind) : 'folder'} size={20} />
          </span>
          <div className="vp-where">
            <div className="vp-title">{title}</div>
            <div className="vp-path" title={status?.folder}>
              {status?.folder ?? ' '}
            </div>
          </div>
          <div className="vp-actions">
            {failed && !place && (
              <button className="button primary" onClick={() => refresh(true)}>
                <Icon name="refresh" size={15} /> Try again
              </button>
            )}
            <button className="button" onClick={() => void window.nv.files.reveal('')}>
              <Icon name="reveal" size={15} /> Show
            </button>
            <button className={`button${place?.kind === 'local' ? ' primary' : ''}`} onClick={() => openModal({ kind: 'move-vault', from: 'settings' })} disabled={!status}>
              {other ? 'Move this folder…' : 'Move my vault…'}
            </button>
          </div>
        </div>
        {place && (
          <p className="vp-status" role="status">
            <Icon name={place.kind === 'local' || place.kind === 'network' ? 'info' : 'check'} size={14} />
            {/* Only on this PC and a network drive are said by the title already: the line says what it means. */}
            {place.kind === 'local' || place.kind === 'network' ? (
              <span>{rest.length ? cap(rest.join(' — ')) : line}</span>
            ) : (
              <span>
                <strong>{line}</strong>
                {rest.length ? ` — ${rest.join(' — ')}` : ''}
              </span>
            )}
          </p>
        )}
      </div>
      {other && (
        <p className="vp-tip vp-other">
          This is another folder of notes you opened, not your vault. Your vault is at {status!.library}.
        </p>
      )}
      {status?.adoptable && (
        <p className="vp-tip vp-other">
          These notes aren’t in a vault yet.{' '}
          <button
            className="home-seeall"
            onClick={async () => {
              try {
                const info = await api().adoptOpen();
                await loadSettings();
                await refresh(true);
                toast(`“${info.name}” is your vault now.`);
              } catch (err) {
                showError(err);
              }
            }}
          >
            Make this folder my vault
          </button>. Ironleaf keeps its settings and templates here; your notes stay as they are.
        </p>
      )}
      {place && place.kind !== 'local' && <p className="vp-tip">Edit on one PC at a time: sync services can’t merge two edits to the same note.</p>}
      {place?.kind === 'local' && <p className="vp-tip">Move it into OneDrive, Dropbox, Google Drive, iCloud Drive or a network drive and it’s kept safe off this PC, and your other PCs see it.</p>}
    </>
  );
}

/** Settings › Files and links › Open another vault folder… */
export async function openAnotherVault(): Promise<void> {
  try {
    const opened = await api().openFolder();
    if (!opened) return;
    await loadSettings();
    placeChanged();
    toast(opened.library ? `Your vault is open from ${opened.path}.` : `“${opened.name}” is open for a look. Nothing was added to it.`);
  } catch (err) {
    showError(err);
  }
}

type Step = { kind: 'choose' } | { kind: 'plan'; plan: MovePlan } | { kind: 'refused'; refusal: MoveRefusal } | { kind: 'moving'; plan: MovePlan; progress: MoveProgress | null } | { kind: 'done'; done: MoveDone } | { kind: 'failed'; words: string };

const PHASE: Record<MoveProgress['phase'], string> = { copying: 'Copying your notes', checking: 'Checking every file', switching: 'Opening it at its new place', tidying: 'Putting the old folder in the Bin' };

/** Move my vault…: where to, what it will do, then every file copied and checked, with how far it is. */
export function MoveVaultDialog({ onClose }: { onClose(): void }) {
  const [status, setStatus] = useState<PlaceStatus | null>(null);
  const [step, setStep] = useState<Step>({ kind: 'choose' });
  const [busy, setBusy] = useState(false);
  const stepRef = useRef(step);
  stepRef.current = step;
  useEffect(() => {
    void api()
      .status(true)
      .then(setStatus, (err) => setStep({ kind: 'failed', words: errorMessage(err) }));
    return api().onProgress((progress) => setStep((s) => (s.kind === 'moving' ? { ...s, progress } : s)));
  }, []);
  const moving = step.kind === 'moving';
  useEscape(() => {
    if (!stepRef.current || stepRef.current.kind !== 'moving') onClose();
  });
  const choose = async (target: MoveTarget | null) => {
    setBusy(true);
    try {
      const plan = await api().plan(target ? target.path : null);
      if (!plan) return;
      setStep(isRefusal(plan) ? { kind: 'refused', refusal: plan } : { kind: 'plan', plan });
    } catch (err) {
      setStep({ kind: 'failed', words: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };
  const move = async (plan: MovePlan) => {
    setStep({ kind: 'moving', plan, progress: null });
    try {
      // What is being typed is saved first, and the open tabs, so they come along.
      await docs.flush();
      await saveWorkspaceNow().catch(() => undefined);
      const done = await api().move();
      await loadSettings();
      placeChanged();
      setStep({ kind: 'done', done });
    } catch (err) {
      setStep({ kind: 'failed', words: errorMessage(err) });
      placeChanged();
    }
  };
  const openInstead = async (v: FoundVault) => {
    setBusy(true);
    try {
      const done = await api().openFound(v.path);
      if (!done) return;
      await loadSettings();
      placeChanged();
      toast(done.words);
      onClose();
    } catch (err) {
      setStep({ kind: 'failed', words: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };
  const local = status?.place.kind === 'local';
  const other = !!status && !status.isLibrary;
  const it = other ? 'this folder' : 'your vault';
  const It = other ? 'This folder' : 'Your vault';
  return (
    <div className="overlay vp-overlay" onMouseDown={() => !moving && onClose()}>
      <div className="dialog vp-dialog" role="dialog" aria-modal="true" aria-label={other ? 'Move this folder' : 'Move my vault'} onMouseDown={(e) => e.stopPropagation()}>
        <div className="vp-dialog-head">
          <span className={`vp-mark small${step.kind === 'done' ? ' done' : ''}`} aria-hidden="true">
            <Icon name={step.kind === 'done' ? 'check' : 'folderOpen'} size={17} />
          </span>
          <h2>{step.kind === 'done' ? `${It} has moved` : step.kind === 'moving' ? `Moving ${it}…` : other ? 'Move this folder' : 'Move my vault'}</h2>
          {!moving && (
            <button className="icon-button vp-close" title="Close" onClick={onClose}>
              <Icon name="close" size={15} />
            </button>
          )}
        </div>

        {step.kind === 'choose' && (
          <>
            <p className="dialog-message">
              {status && status.targets.length
                ? `Choose where it goes. Every file is copied and checked first; then Ironleaf opens ${it} there, and the old folder goes to the Bin.`
                : status
                  ? 'No OneDrive, Dropbox, Google Drive or iCloud Drive folder was found on this PC. Choose a folder that’s kept safe off this PC, such as a network drive.'
                  : 'Looking for the places it can go…'}
            </p>
            <div className="vp-targets" role="list">
              {status?.targets.map((t) => (
                <button key={t.id} className="vp-target" role="listitem" disabled={busy} onClick={() => void choose(t)}>
                  <span className="vp-target-icon">
                    <Icon name={kindIcon(t.kind)} size={17} />
                  </span>
                  <span className="vp-target-words">
                    <span className="vp-target-label">{t.label}</span>
                    <span className="vp-target-path" title={t.path}>
                      {pathTail(t.path)}
                    </span>
                  </span>
                  <Icon name="forward" size={14} className="vp-faint" />
                </button>
              ))}
              <button className="vp-target other" role="listitem" disabled={busy || !status} onClick={() => void choose(null)}>
                <span className="vp-target-icon">
                  <Icon name="folder" size={17} />
                </span>
                <span className="vp-target-words">
                  <span className="vp-target-label">Choose a folder…</span>
                  <span className="vp-target-path">Anywhere else: another drive, a network drive or a NAS</span>
                </span>
                <Icon name="forward" size={14} className="vp-faint" />
              </button>
            </div>
            {status && !local && (
              <p className="vp-note">
                {It} is in {status.place.name} now.
              </p>
            )}
          </>
        )}

        {step.kind === 'plan' && (
          <>
            <p className="dialog-message">
              Move {it} to <strong>{step.plan.label}</strong>? {countWords(step.plan.files, 'file')}, {sizeWords(step.plan.bytes)}.
            </p>
            <dl className="vp-fromto">
              <dt>From</dt>
              <dd>{step.plan.from}</dd>
              <dt>To</dt>
              <dd>{step.plan.to}</dd>
            </dl>
            <p className="vp-note">
              <Icon name="history" size={13} /> The old folder goes to the Bin only once every file is copied and checked, so you can restore it from there. If anything goes wrong, {it} stays where it is.
            </p>
            <div className="dialog-actions">
              <button className="button" onClick={() => setStep({ kind: 'choose' })}>
                Back
              </button>
              <button className="button primary" onClick={() => void move(step.plan)}>
                {other ? 'Move this folder' : 'Move my vault'}
              </button>
            </div>
          </>
        )}

        {step.kind === 'refused' && (
          <>
            <p className="dialog-message">{step.refusal.words}</p>
            <div className="dialog-actions">
              <button className="button" onClick={() => setStep({ kind: 'choose' })}>
                Choose another place
              </button>
              {step.refusal.vault && (
                <button className="button primary" disabled={busy} onClick={() => void openInstead(step.refusal.vault!)}>
                  Open that vault instead
                </button>
              )}
            </div>
          </>
        )}

        {step.kind === 'moving' && <MoveProgressView plan={step.plan} progress={step.progress} />}

        {step.kind === 'done' && (
          <>
            <p className="dialog-message">{step.done.words}</p>
            <div className="dialog-actions">
              <button className="button primary" onClick={onClose}>
                Done
              </button>
            </div>
          </>
        )}

        {step.kind === 'failed' && (
          <>
            <p className="dialog-message vp-failed">{step.words}</p>
            <div className="dialog-actions">
              <button className="button" onClick={onClose}>
                Close
              </button>
              <button className="button primary" onClick={() => setStep({ kind: 'choose' })}>
                Try again
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function MoveProgressView({ plan, progress }: { plan: MovePlan; progress: MoveProgress | null }) {
  const phase = progress?.phase ?? 'copying';
  const share = progress && progress.total > 0 ? Math.min(1, progress.done / progress.total) : phase === 'switching' || phase === 'tidying' ? 1 : 0;
  const files = progress && progress.totalFiles ? ` · ${progress.files.toLocaleString('en-AU')} of ${countWords(progress.totalFiles, 'file')}` : '';
  return (
    <div className="vp-progress" aria-live="polite">
      <p className="dialog-message">
        To <strong>{plan.label}</strong>. Keep Ironleaf open until it’s done.
      </p>
      <div className="vp-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)}>
        <span style={{ width: `${Math.max(2, share * 100)}%` }} />
      </div>
      <p className="vp-phase">
        {PHASE[phase]}
        {phase === 'copying' || phase === 'checking' ? `${files}` : '…'}
        {progress && progress.total > 0 && (phase === 'copying' || phase === 'checking') && <span className="vp-faint"> · {sizeWords(progress.done)} of {sizeWords(progress.total)}</span>}
      </p>
    </div>
  );
}

/** Today's vault rows: the vault found on a new PC, and once, that the notes are only on this PC — each a row of
 *  the "things need a look" list, opening to its full card with every button it had (8 Nov 2026, calm Today). */
export function VaultCards() {
  const { status } = usePlace();
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  if (!status) return null;
  const found = status.found && !hidden.has(`found:${status.found.path}`) ? status.found : null;
  const tip = !found && status.onlyHereCard && !hidden.has(`tip:${status.folder}`);
  if (!found && !tip) return null;
  const hide = (kind: 'tip' | 'found', folder: string) => {
    setHidden((h) => new Set(h).add(`${kind}:${folder}`));
    void api().dismiss(kind, folder).catch(showError);
  };
  if (found) {
    const counts = `${countWords(found.notes, 'note')}${found.projects ? `, ${countWords(found.projects, 'project')}` : ''}`;
    return (
      <LookRow icon="cloud" title={`Found your vault in ${found.name}, ${counts}`}>
        <section className="td-section vp-today found" data-section="vault-found" aria-labelledby="vp-found-h">
          <span className="vp-today-icon">
            <Icon name="cloud" size={18} />
          </span>
          <div className="vp-today-words">
            <h2 id="vp-found-h">
              Found your vault in {found.name}, {counts}
            </h2>
            <p>
              It’s at <span className="vp-inline-path">{found.path}</span>. Open it to carry on where you left off; this new, empty vault is set aside.
            </p>
            <div className="vp-today-actions">
              <button
                className="button primary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const done = await api().openFound(found.path);
                    if (!done) return;
                    await loadSettings();
                    placeChanged();
                    toast(done.words);
                  } catch (err) {
                    showError(err);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Open it
              </button>
              <button className="text-button" disabled={busy} onClick={() => hide('found', found.path)}>
                Keep this new vault
              </button>
            </div>
          </div>
        </section>
      </LookRow>
    );
  }
  const first = status.targets.find((t) => t.kind !== 'network');
  return (
    <LookRow icon="computer" title={status.isLibrary ? 'Your notes are only on this PC' : 'These notes are only on this PC'}>
      <section className="td-section vp-today only-here" data-section="vault-only-here" aria-labelledby="vp-here-h">
        <span className="vp-today-icon">
          <Icon name="computer" size={18} />
        </span>
        <div className="vp-today-words">
          <h2 id="vp-here-h">{status.isLibrary ? 'Your notes are only on this PC' : 'These notes are only on this PC'}</h2>
          <p>If this PC is lost or breaks, your notes go with it, and another PC won’t see them. {first ? `Move ${status.isLibrary ? 'your vault' : 'this folder'} into ${first.label.split(' › ')[0]} and they follow you.` : `Move ${status.isLibrary ? 'your vault' : 'this folder'} to a folder that’s kept safe off this PC, such as OneDrive, Dropbox or a network drive.`}</p>
          <div className="vp-today-actions">
            <button className="button primary" onClick={() => openModal({ kind: 'move-vault' })}>
              {status.isLibrary ? 'Move my vault…' : 'Move this folder…'}
            </button>
            <button className="text-button" onClick={() => hide('tip', status.folder)}>
              Not now
            </button>
          </div>
        </div>
      </section>
    </LookRow>
  );
}
