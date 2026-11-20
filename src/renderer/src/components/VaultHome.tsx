// One standard home for vaults (23 Oct 2026; src/main/vault-home-service.ts, src/shared/vault-home.ts). Settings › Files
// and links shows each vault on this PC (where it is, what syncs it, which of your PCs has it open), your PCs and the vault
// each has open, New vault…, Import… and Export vault…; when this vault is only on this PC and your other PCs have
// another open, a plain warning with the vault they use (when it's here too) and a checked move into
// Documents\Ironleaf, the old folder kept until you say it can go. Today shows the same warning.

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { countWords, isRefusal, sizeWords, type MoveDone, type MoveProgress, type MoveRefusal } from '../../../shared/vault-place';
import { placeLine, type HomeMovePlan, type HomeStatus, type HomeVault, type HomeWarning, type ImportPlan, type ImportProgress, type ImportSummary, type PcEntry } from '../../../shared/vault-home';
import { plural } from '../../../shared/words';
import * as A from '../state/actions';
import { docs } from '../state/docs';
import { saveWorkspaceNow } from '../state/layout';
import { loadSettings, showError, toast, useApp } from '../state/store';
import { errorMessage } from '../lib/errors';
import { useEscape } from '../lib/useEscape';
import { Icon } from './Icon';
import { LookRow } from './LookRow';
import { kindIcon, VaultCards } from './VaultPlace';
import { BackupToday, VaultSyncSection, VaultSyncToday } from './VaultSync';
import { LivePairingSection, PairDialog, PairedSourcesSection, SourceChoices } from './PairedSources';
import type { FileKind as SourceKind } from '../../../shared/pairing/types';
import '../styles/vault-home.css';

const api = () => window.nv.home;
const changed = () => {
  window.dispatchEvent(new Event('nv-place-changed'));
  window.dispatchEvent(new Event('nv-home-changed'));
};

/** Your vaults and PCs, read when the vault opens (and when something here changes it). */
export function useHome(): { status: HomeStatus | null; failed: boolean; refresh(fresh?: boolean): void } {
  const vaultPath = useApp((s) => s.vault?.path);
  const [status, setStatus] = useState<HomeStatus | null>(null);
  // Unreadable keeps last-known (so a last-known warning stays visible) and says so (9.2 uplift F129).
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
    const t = setTimeout(() => refresh(), 300);
    return () => clearTimeout(t);
  }, [vaultPath, refresh]);
  useEffect(() => {
    const again = () => refresh();
    window.addEventListener('nv-home-changed', again);
    return () => window.removeEventListener('nv-home-changed', again);
  }, [refresh]);
  return { status, failed, refresh };
}

/** A long folder's end, where its name is; the whole path on hover. */
function tail(p: string, max = 60): string {
  if (p.length <= max) return p;
  const sep = p.includes('\\') ? '\\' : '/';
  const parts = p.split(/[\\/]+/).filter(Boolean);
  let out = parts.pop() ?? p;
  while (parts.length && out.length + parts[parts.length - 1].length + 1 <= max - 2) out = `${parts.pop()}${sep}${out}`;
  return `…${sep}${out}`;
}

const homeLabel = (home: string) => {
  const parts = home.split(/[\\/]+/).filter(Boolean);
  return parts.slice(-2).join(home.includes('\\') ? '\\' : '/');
};

function ago(at: number | null): string {
  if (!at) return 'not seen yet';
  const m = Math.round((Date.now() - at) / 60000);
  return m < 2 ? 'just now' : m < 60 ? `${m} minutes ago` : m < 48 * 60 ? `${plural(Math.round(m / 60), 'hour')} ago` : `${Math.round(m / 1440)} days ago`;
}

// ── The warning ──────────────────────────────────────────────────────────────────────────────────────────────────

function WarningCard({ warning, status, where, onMove }: { warning: HomeWarning; status: HomeStatus; where: 'today' | 'settings'; onMove(): void }) {
  const [busy, setBusy] = useState(false);
  const [gone, setGone] = useState(false);
  if (gone) return null;
  const open = async () => {
    if (!warning.openHere) return;
    setBusy(true);
    try {
      await docs.flush();
      await saveWorkspaceNow().catch(() => undefined);
      const info = await api().open(warning.openHere.path);
      if (!info) return;
      await loadSettings();
      changed();
      toast(info.library ? `“${warning.openHere.name}” is open: the same vault as your other PCs.` : `“${warning.openHere.name}” is open for a look. Nothing was added to it.`);
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };
  const card = (
    <section className={`vh-warn${where === 'today' ? ' td-section' : ''}`} data-section="vault-home-warning" aria-labelledby={`vh-warn-${where}`}>
      <span className="vh-warn-icon" aria-hidden="true">
        <Icon name="warning" size={18} />
      </span>
      <div className="vh-warn-words">
        <h2 id={`vh-warn-${where}`}>
          {warning.title} <span className="tag amber">At risk</span>
        </h2>
        <p>{warning.words}</p>
        <ul className="vh-warn-pcs">
          {warning.others.map((o) => (
            <li key={o.pc}>
              <Icon name="computer" size={13} />
              <span>
                <strong>{o.pc}:</strong> {o.vault} <span className="vh-faint">· {o.placeName === 'this PC' ? 'only on that PC' : `synced with ${o.placeName}`}</span>
              </span>
            </li>
          ))}
          <li>
            <Icon name="computer" size={13} />
            <span>
              <strong>This PC:</strong> {status.current?.name} <span className="vh-faint">· only on this PC</span>
            </span>
          </li>
        </ul>
        <div className="vh-actions">
          {warning.openHere && (
            <button className="button primary" disabled={busy} onClick={() => void open()}>
              Open “{warning.openHere.name}”
            </button>
          )}
          {warning.moveTo && (
            <button className={`button${warning.openHere ? '' : ' primary'}`} disabled={busy} onClick={onMove}>
              Move it to {homeLabel(status.home)}…
            </button>
          )}
          <button
            className="text-button"
            disabled={busy}
            onClick={() => {
              setGone(true);
              void api().dismiss().catch(showError);
            }}
          >
            Not now
          </button>
        </div>
      </div>
    </section>
  );
  // On Today the warning is a row of the "things need a look" list, opening to this same card (8 Nov 2026,
  // calm Today); in Settings it stays a card.
  if (where === 'today') return <LookRow icon="warning" title={warning.title}>{card}</LookRow>;
  return card;
}

/** Today's vault rows (8 Nov 2026, calm Today: rows of the "things need a look" list, opening to their cards): a
 *  failed backup first when it speaks (9 Nov 2026, break job), then the warning when your PCs have different vaults
 *  open (it says all the "only on this PC" card would, so that one waits), else Where your vault is's own rows
 *  (components/VaultPlace.tsx), with the sync line beside them. */
export function VaultTodayCards() {
  const { status } = useHome();
  const [moving, setMoving] = useState(false);
  // This PC's sync state (components/VaultSync.tsx): a quiet line when all is well, a card when something needs the person.
  if (!status?.warning)
    return (
      <>
        <BackupToday />
        <VaultSyncToday />
        <VaultCards />
      </>
    );
  return (
    <>
      <BackupToday />
      <WarningCard warning={status.warning} status={status} where="today" onMove={() => setMoving(true)} />
      {moving && <MoveHomeDialog status={status} onClose={() => setMoving(false)} />}
    </>
  );
}

// ── Settings › Files and links ─────────────────────────────────────────────────────────────────────────────────────

type Dialog = null | { kind: 'move' } | { kind: 'new' } | { kind: 'import' } | { kind: 'export' } | { kind: 'pair'; source: SourceKind };

export function VaultHomeSection() {
  const { status, failed, refresh } = useHome();
  useEffect(() => refresh(true), [refresh]);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pairsSeen, setPairsSeen] = useState(0);
  const openVault = async (v: HomeVault) => {
    setBusy(v.path);
    try {
      await docs.flush();
      await saveWorkspaceNow().catch(() => undefined);
      const info = await api().open(v.path);
      if (!info) return;
      await loadSettings();
      changed();
      toast(info.library ? `“${v.name}” is open.` : `“${v.name}” is open for a look. Nothing was added to it.`);
    } catch (err) {
      showError(err);
    } finally {
      setBusy(null);
    }
  };
  const oldFolder = async (from: string, action: 'trash' | 'keep') => {
    setBusy(from);
    try {
      toast(await api().oldFolder(from, action));
      refresh();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(null);
    }
  };
  const label = status ? homeLabel(status.home) : 'Documents\\Ironleaf';
  return (
    <>
      {status?.warning && <WarningCard warning={status.warning} status={status} where="settings" onMove={() => setDialog({ kind: 'move' })} />}
      {status?.oldFolders.map((o) => (
        <div key={o.from} className="vh-old" data-old={o.from}>
          <Icon name="history" size={16} />
          <div className="vh-old-words">
            <strong>Your vault’s old folder is still there</strong>
            <span>
              Every file was checked at its new place. The old copy is still at <span className="vh-path" title={o.from}>{tail(o.from, 52)}</span>; put it away once you’re happy everything is there.
            </span>
          </div>
          <div className="vh-actions">
            <button className="button" disabled={busy === o.from} onClick={() => void oldFolder(o.from, 'trash')}>
              Put it in the Bin
            </button>
            <button className="text-button" disabled={busy === o.from} onClick={() => void oldFolder(o.from, 'keep')}>
              Keep it
            </button>
          </div>
        </div>
      ))}

      <VaultSyncSection />

      <h3>Your vaults</h3>
      <p className="vh-lead">
        Every vault lives in <strong>{label}</strong>
        {status ? (status.homePlace.kind === 'local' ? ', which is only on this PC.' : `, synced with ${status.homePlace.name}, so each of your PCs has the same ones.`) : '.'} Your other apps always use the vault open here.
      </p>
      <div className="vh-list" role="list" aria-label="Your vaults">
        {!status && (failed ? <div className="vh-empty">Couldn't find your vaults. <button className="button" onClick={() => refresh(true)}>Try again</button></div> : <div className="vh-empty">Looking for your vaults…</div>)}
        {status?.vaults.map((v) => (
          <div key={v.path} className={`vh-vault${v.open ? ' is-open' : ''}${v.place.kind === 'local' ? ' is-local' : ''}`} role="listitem" data-vault={v.name}>
            <span className="vh-vault-icon" aria-hidden="true">
              <Icon name={v.inHome && v.place.kind !== 'local' ? 'vault' : kindIcon(v.place.kind)} size={18} />
            </span>
            <div className="vh-vault-words">
              <div className="vh-vault-name">
                <span>{v.name}</span>
                {v.open && <span className="vh-pill on">Open now</span>}
                {v.library && !v.open && <span className="vh-pill">Opens at start</span>}
                {!v.inHome && <span className="vh-pill warn">Outside {label}</span>}
              </div>
              <div className="vh-vault-path" title={v.path}>
                {tail(v.path)}
              </div>
              <div className="vh-vault-meta">
                <span className={v.place.kind === 'local' ? 'vh-warn-text' : 'vh-ok-text'}>
                  <Icon name={v.place.kind === 'local' ? 'info' : 'check'} size={12} /> {placeLine(v.place)}
                </span>
                <span className="vh-faint">
                  {countWords(v.notes, 'note')}
                  {v.projects ? ` · ${countWords(v.projects, 'project')}` : ''}
                </span>
                {v.pcs.length > 0 && (
                  <span className="vh-faint">
                    <Icon name="computer" size={12} /> Open on {v.pcs.join(', ')}
                  </span>
                )}
              </div>
            </div>
            <div className="vh-actions">
              {!v.open && (
                <button className="button" disabled={!!busy} onClick={() => void openVault(v)}>
                  Open
                </button>
              )}
              {v.open && status.moveTo && (
                <button className="button" disabled={!!busy} onClick={() => setDialog({ kind: 'move' })}>
                  Move to {label}…
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="vh-tools">
        <button className="button" onClick={() => setDialog({ kind: 'new' })}>
          <Icon name="plus" size={14} /> New vault…
        </button>
        <button className="button" onClick={() => setDialog({ kind: 'import' })}>
          <Icon name="inbox" size={14} /> Import…
        </button>
        <button className="button" onClick={() => setDialog({ kind: 'export' })} disabled={!status?.current}>
          <Icon name="download" size={14} /> Export vault…
        </button>
      </div>

      <LivePairingSection refreshKey={pairsSeen} onChanged={() => setPairsSeen((n) => n + 1)} />

      <PairedSourcesSection refreshKey={pairsSeen} onAgain={(source) => setDialog({ kind: 'pair', source })} />

      <h3>Your PCs</h3>
      <PcTable pcs={status?.pcs ?? null} status={status} />

      {dialog?.kind === 'move' && status && <MoveHomeDialog status={status} onClose={() => (setDialog(null), refresh(true))} />}
      {dialog?.kind === 'new' && status && <NewVaultDialog status={status} onClose={() => (setDialog(null), refresh(true))} />}
      {dialog?.kind === 'import' && <ImportDialog onClose={() => (setDialog(null), refresh(true))} onPair={(source) => setDialog({ kind: 'pair', source })} />}
      {dialog?.kind === 'pair' && <PairDialog source={dialog.source} onClose={() => (setDialog(null), setPairsSeen((n) => n + 1), refresh(true))} />}
      {dialog?.kind === 'export' && <ExportDialog onClose={() => setDialog(null)} />}
    </>
  );
}

function PcTable({ pcs, status }: { pcs: PcEntry[] | null; status: HomeStatus | null }) {
  if (!status) return null;
  if (!pcs || !pcs.length)
    return <p className="vh-lead vh-faint-lead">Each of your PCs and the vault it has open show here once they open it.</p>;
  const mine = status.current;
  return (
    <div className="vh-pcs" role="table" aria-label="Your PCs">
      <div className="vh-pc head" role="row">
        <span role="columnheader">PC</span>
        <span role="columnheader">Vault open</span>
        <span role="columnheader">Where</span>
      </div>
      {pcs.map((pc) => {
        const v = pc.me && mine ? { name: mine.name, placeName: status.vaults.find((x) => x.open)?.place.name ?? '', place: status.vaults.find((x) => x.open)?.place.kind ?? 'local', id: mine.id } : pc.vault;
        const same = !!v && !!mine && (v.id && mine.id ? v.id === mine.id : v.name === mine.name);
        return (
          <div key={pc.id} className={`vh-pc${pc.me ? ' me' : ''}`} role="row" data-pc={pc.name}>
            <span role="cell" className="vh-pc-name">
              <span className={`vh-dot${pc.online ? ' on' : ''}`} aria-hidden="true" />
              <span>
                <strong>{pc.me ? `${pc.name} (this PC)` : pc.name}</strong>
                <span className="vh-faint">{pc.me ? 'on now' : pc.online ? 'on now' : `last seen ${ago(pc.lastSeen)}`}</span>
              </span>
            </span>
            <span role="cell">
              {v ? (
                <>
                  {v.name}
                  {!pc.me && mine && <span className={same ? 'vh-ok-text small' : 'vh-warn-text small'}>{same ? ' · the same as here' : ' · a different vault'}</span>}
                </>
              ) : (
                <span className="vh-faint">Not known yet</span>
              )}
            </span>
            <span role="cell" className="vh-faint">
              {v ? (v.place === 'local' ? (pc.me ? 'Only on this PC' : 'Only on that PC') : v.place === 'network' ? 'A network drive' : `Synced with ${v.placeName}`) : ''}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Dialogs ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export function Shell({ title, icon, onClose, locked, children }: { title: string; icon: Parameters<typeof Icon>[0]['name']; onClose(): void; locked?: boolean; children: ReactNode }) {
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  useEscape(() => {
    if (!lockedRef.current) onClose();
  });
  return (
    <div className="overlay vp-overlay" onMouseDown={() => !locked && onClose()}>
      <div className="dialog vp-dialog vh-dialog" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.stopPropagation()}>
        <div className="vp-dialog-head">
          <span className="vp-mark small" aria-hidden="true">
            <Icon name={icon} size={17} />
          </span>
          <h2>{title}</h2>
          {!locked && (
            <button className="icon-button vp-close" title="Close" onClick={onClose}>
              <Icon name="close" size={15} />
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

function Bar({ share, words }: { share: number; words: string }) {
  return (
    <div className="vp-progress" aria-live="polite">
      <div className="vp-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)}>
        <span style={{ width: `${Math.max(2, share * 100)}%` }} />
      </div>
      <p className="vp-phase">{words}</p>
    </div>
  );
}

type MoveStep = { kind: 'planning' } | { kind: 'plan'; plan: HomeMovePlan } | { kind: 'refused'; refusal: MoveRefusal } | { kind: 'moving'; progress: MoveProgress | null } | { kind: 'done'; done: MoveDone } | { kind: 'failed'; words: string };

/** Move it to Documents\Ironleaf: a checked copy, the old folder kept until you say it can go. */
export function MoveHomeDialog({ status, onClose }: { status: HomeStatus; onClose(): void }) {
  const [step, setStep] = useState<MoveStep>({ kind: 'planning' });
  const label = homeLabel(status.home);
  useEffect(() => {
    void api()
      .planMove()
      .then(
        (p) => setStep(isRefusal(p) ? { kind: 'refused', refusal: p } : { kind: 'plan', plan: p }),
        (err) => setStep({ kind: 'failed', words: errorMessage(err) }),
      );
    return window.nv.place.onProgress((progress) => setStep((s) => (s.kind === 'moving' ? { kind: 'moving', progress } : s)));
  }, []);
  const move = async () => {
    setStep({ kind: 'moving', progress: null });
    try {
      await docs.flush();
      await saveWorkspaceNow().catch(() => undefined);
      const done = await api().move();
      await loadSettings();
      changed();
      setStep({ kind: 'done', done });
    } catch (err) {
      setStep({ kind: 'failed', words: errorMessage(err) });
      changed();
    }
  };
  const p = step.kind === 'moving' ? step.progress : null;
  const share = p && p.total > 0 ? Math.min(1, p.done / p.total) : p && (p.phase === 'switching' || p.phase === 'tidying') ? 1 : 0;
  return (
    <Shell title={step.kind === 'done' ? 'Your vault has moved' : step.kind === 'moving' ? 'Moving your vault…' : `Move it to ${label}`} icon={step.kind === 'done' ? 'check' : 'folderOpen'} onClose={onClose} locked={step.kind === 'moving'}>
      {step.kind === 'planning' && <p className="dialog-message">Working out what to copy…</p>}
      {step.kind === 'plan' && (
        <>
          <p className="dialog-message">
            Copy “{status.current?.name}” into {label}? {countWords(step.plan.files, 'file')}, {sizeWords(step.plan.bytes)}. Every file is checked before Ironleaf opens it there{status.homePlace.kind !== 'local' ? `, and ${status.homePlace.name} keeps it on your other PCs` : ''}.
          </p>
          <dl className="vp-fromto">
            <dt>From</dt>
            <dd>{step.plan.from}</dd>
            <dt>To</dt>
            <dd>{step.plan.to}</dd>
          </dl>
          <p className="vp-note">
            <Icon name="history" size={13} /> The old folder stays where it is until you say it can go. If anything goes wrong, your vault stays where it is.
          </p>
          <div className="dialog-actions">
            <button className="button" onClick={onClose}>
              Cancel
            </button>
            <button className="button primary" onClick={() => void move()}>
              Copy and open it there
            </button>
          </div>
        </>
      )}
      {step.kind === 'refused' && (
        <>
          <p className="dialog-message">{step.refusal.words}</p>
          <div className="dialog-actions">
            <button className="button primary" onClick={onClose}>
              Close
            </button>
          </div>
        </>
      )}
      {step.kind === 'moving' && <Bar share={share} words={p ? `${p.phase === 'copying' ? 'Copying your notes' : p.phase === 'checking' ? 'Checking every file' : 'Opening it at its new place'}${p.totalFiles ? ` · ${p.files.toLocaleString('en-AU')} of ${countWords(p.totalFiles, 'file')}` : ''}` : 'Starting…'} />}
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
            <button className="button primary" onClick={onClose}>
              Close
            </button>
          </div>
        </>
      )}
    </Shell>
  );
}

function NewVaultDialog({ status, onClose }: { status: HomeStatus; onClose(): void }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = homeLabel(status.home);
  const make = async (choose: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await docs.flush();
      await saveWorkspaceNow().catch(() => undefined);
      const info = await api().newVault(name, choose);
      if (!info) return;
      await loadSettings();
      changed();
      toast(`“${info.name}” is ready and open, in ${info.path}.`);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Shell title="New vault" icon="vault" onClose={onClose} locked={busy}>
      <p className="dialog-message">
        A vault of its own, for notes you keep apart (work, a club, a side project). It goes in {label}
        {status.homePlace.kind !== 'local' ? `, which ${status.homePlace.name} keeps on your other PCs` : ''}.
      </p>
      <label className="vh-field">
        <span>Name</span>
        <input
          className="setting-input"
          autoFocus
          value={name}
          maxLength={80}
          placeholder="Work"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && name.trim()) void make(false);
          }}
        />
      </label>
      {name.trim() && <p className="vh-faint vh-where-line">{`${status.home}${status.home.includes('\\') ? '\\' : '/'}${name.trim()}`}</p>}
      {error && <p className="vp-failed">{error}</p>}
      <div className="dialog-actions vh-split">
        <button className="text-button" disabled={busy || !name.trim()} onClick={() => void make(true)}>
          Choose another folder…
        </button>
        <span className="vh-grow" />
        <button className="button" disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <button className="button primary" disabled={busy || !name.trim()} onClick={() => void make(false)}>
          Make it
        </button>
      </div>
    </Shell>
  );
}

type ImportStep = { kind: 'choose' } | { kind: 'reading'; progress: ImportProgress | null } | { kind: 'plan'; plan: ImportPlan } | { kind: 'merging'; plan: ImportPlan; progress: ImportProgress | null } | { kind: 'done'; summary: ImportSummary; undone?: string } | { kind: 'failed'; words: string };

export function ImportDialog({ onClose, onPair, initial }: { onClose(): void; onPair(source: SourceKind): void; initial?: 'folder' | 'apps' | 'all' }) {
  const [step, setStep] = useState<ImportStep>({ kind: 'choose' });
  // The Import page opens the dialog already on its row (10.0 item 16): folder shows folder, apps shows apps.
  const [showAll, setShowAll] = useState(initial === 'all' || !initial);
  useEffect(() => api().onProgress((progress) => setStep((s) => (s.kind === 'reading' ? { kind: 'reading', progress } : s.kind === 'merging' ? { ...s, progress } : s))), []);
  const close = () => {
    if (step.kind === 'plan') void api().cancelImport();
    onClose();
  };
  const pick = async (kind: 'folder' | 'zip') => {
    setStep({ kind: 'reading', progress: null });
    try {
      const plan = await api().pickImport(kind);
      setStep(plan ? { kind: 'plan', plan } : { kind: 'choose' });
    } catch (err) {
      setStep({ kind: 'failed', words: errorMessage(err) });
    }
  };
  const run = async (plan: ImportPlan) => {
    setStep({ kind: 'merging', plan, progress: null });
    try {
      await docs.flush();
      const summary = await api().importNow();
      changed();
      setStep({ kind: 'done', summary });
    } catch (err) {
      setStep({ kind: 'failed', words: errorMessage(err) });
    }
  };
  const busy = step.kind === 'reading' || step.kind === 'merging';
  const pr = step.kind === 'reading' || step.kind === 'merging' ? step.progress : null;
  return (
    <Shell title={step.kind === 'done' ? 'Imported' : 'Import'} icon={step.kind === 'done' ? 'check' : 'inbox'} onClose={close} locked={busy}>
      {step.kind === 'choose' && (
        <>
          {!showAll && initial === 'folder' && <p className="dialog-message">Bring in a vault from another PC or a USB drive, or a folder of notes. Everything is merged: what is the same comes in once, notes that differ are combined keeping every line, and nothing here is renamed or lost.</p>}
          {!showAll && initial === 'apps' && <p className="dialog-message">Bring notes from another app. Each note keeps where it came from, so bringing it in again later never overwrites your changes.</p>}
          {(showAll || !initial || initial === 'all') && <p className="dialog-message">Bring in a vault from another PC or a USB drive, or notes from another app. Everything is merged: what’s the same comes in once, notes that differ are combined keeping every line, and nothing here is renamed or lost.</p>}
          {(showAll || initial === 'folder') && (
            <>
              <div className="vp-targets" role="list">
                <button className="vp-target" role="listitem" onClick={() => void pick('zip')}>
                  <span className="vp-target-icon">
                    <Icon name="download" size={17} />
                  </span>
                  <span className="vp-target-words">
                    <span className="vp-target-label">A vault export (.zip)</span>
                    <span className="vp-target-path">Made by Export vault on another PC, or any zip of notes</span>
                  </span>
                  <Icon name="forward" size={14} className="vp-faint" />
                </button>
                <button className="vp-target" role="listitem" onClick={() => void pick('folder')}>
                  <span className="vp-target-icon">
                    <Icon name="folder" size={17} />
                  </span>
                  <span className="vp-target-words">
                    <span className="vp-target-label">A folder</span>
                    <span className="vp-target-path">A vault on a USB drive, Markdown or Word files, Apple Notes or OneNote pages (HTML, web archive, CSV)</span>
                  </span>
                  <Icon name="forward" size={14} className="vp-faint" />
                </button>
              </div>
              <p className="vp-note">
                <Icon name="info" size={13} /> To bring your vault from another PC: Export vault there, copy the file across, and import it here.
              </p>
            </>
          )}
          {(showAll || initial === 'apps') && (
            <>
              <h3 className="pair-head">From another app</h3>
              <p className="vp-note">Notes from Evernote, Notion, Google Keep, Readwise, Logseq or Roam, each keeping where it came from. {showAll ? 'Apple Notes and OneNote pages come in as A folder above.' : 'Apple Notes and OneNote pages come in as A folder. Choose See all ways to import for it.'}</p>
              <SourceChoices onPick={onPair} />
            </>
          )}
          {!showAll && (
            <div className="dialog-actions">
              <button className="text-button" onClick={() => setShowAll(true)}>
                See all ways to import
              </button>
            </div>
          )}
        </>
      )}
      {step.kind === 'reading' && <Bar share={pr && pr.total ? pr.done / pr.total : 0} words={pr?.phase === 'unpacking' ? `Unpacking · ${sizeWords(pr.done)} of ${sizeWords(pr.total)}` : 'Looking at what’s there…'} />}
      {step.kind === 'plan' && (
        <>
          <p className="dialog-message">
            {step.plan.kind === 'vault' ? (
              <>
                Merge the vault <strong>{step.plan.sourceName}</strong> into this one: {countWords(step.plan.files, 'file')} ({countWords(step.plan.notes, 'note')}), {sizeWords(step.plan.bytes)}. Its notes keep their folders.
              </>
            ) : (
              <>
                Bring in <strong>{step.plan.sourceName}</strong>: {countWords(step.plan.files, 'file')} ({countWords(step.plan.notes, 'page')}), {sizeWords(step.plan.bytes)}, into a folder “{step.plan.into}”. Pages from other apps become notes, with the originals kept beside them.
              </>
            )}
          </p>
          <p className="vp-note">
            <Icon name="history" size={13} /> Notes here that change are kept in File recovery first.
          </p>
          <div className="dialog-actions">
            <button className="button" onClick={close}>
              Cancel
            </button>
            <button className="button primary" onClick={() => void run(step.plan)}>
              Import
            </button>
          </div>
        </>
      )}
      {step.kind === 'merging' && (
        <>
          <Bar share={pr && pr.total ? pr.done / pr.total : 0} words={`Merging ${step.plan.sourceName}${pr && pr.total ? ` · ${sizeWords(pr.done)} of ${sizeWords(pr.total)}` : '…'}`} />
          <div className="dialog-actions">
            <button className="button" onClick={() => void api().cancelImport()}>
              Stop
            </button>
          </div>
        </>
      )}
      {step.kind === 'done' && (
        <>
          <p className="dialog-message">{step.summary.words}</p>
          {(step.summary.merged.length > 0 || step.summary.keptApart.length > 0 || step.summary.skipped.length > 0) && (
            <div className="vh-summary">
              {step.summary.merged.length > 0 && (
                <details open={step.summary.merged.length <= 6}>
                  <summary>Combined ({step.summary.merged.length})</summary>
                  <ul>
                    {step.summary.merged.slice(0, 50).map((r) => (
                      <li key={r}>{A.titleOf(r)}</li>
                    ))}
                  </ul>
                </details>
              )}
              {step.summary.keptApart.length > 0 && (
                <details>
                  <summary>Kept beside their own ({step.summary.keptApart.length})</summary>
                  <ul>
                    {step.summary.keptApart.slice(0, 50).map((k) => (
                      <li key={k.rel}>{A.titleOf(k.at)}</li>
                    ))}
                  </ul>
                </details>
              )}
              {step.summary.skipped.length > 0 && (
                <details>
                  <summary>Not brought in ({step.summary.skipped.length})</summary>
                  <ul>
                    {step.summary.skipped.slice(0, 50).map((k) => (
                      <li key={k.rel}>
                        {A.titleOf(k.rel)}: {k.why}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
          {step.kind === 'done' && step.undone && <p className="dialog-message">{step.undone}</p>}
          <div className="dialog-actions">
            {step.kind === 'done' && step.summary.batchId && step.summary.undoable && step.summary.undoable.notes + step.summary.undoable.files > 0 && !step.undone && (
              <button
                className="button"
                onClick={() =>
                  void api()
                    .undoImport(step.summary.batchId!)
                    .then(
                      (back) => {
                        changed();
                        setStep((s) => (s.kind === 'done' ? { ...s, undone: back.words } : s));
                      },
                      (err) => setStep({ kind: 'failed', words: errorMessage(err) }),
                    )
                }
              >
                Undo
              </button>
            )}
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
    </Shell>
  );
}

function ExportDialog({ onClose }: { onClose(): void }) {
  const [step, setStep] = useState<{ kind: 'ready' } | { kind: 'packing'; progress: ImportProgress | null } | { kind: 'done'; words: string } | { kind: 'failed'; words: string }>({ kind: 'ready' });
  useEffect(() => api().onProgress((progress) => setStep((s) => (s.kind === 'packing' ? { kind: 'packing', progress } : s))), []);
  const run = async () => {
    setStep({ kind: 'packing', progress: null });
    try {
      await docs.flush();
      await saveWorkspaceNow().catch(() => undefined);
      const done = await api().exportVault();
      setStep(done ? { kind: 'done', words: done.words } : { kind: 'ready' });
    } catch (err) {
      setStep({ kind: 'failed', words: errorMessage(err) });
    }
  };
  const p = step.kind === 'packing' ? step.progress : null;
  return (
    <Shell title={step.kind === 'done' ? 'Exported' : 'Export vault'} icon={step.kind === 'done' ? 'check' : 'download'} onClose={onClose} locked={step.kind === 'packing'}>
      {step.kind === 'ready' && (
        <>
          <p className="dialog-message">Save the whole vault in one zip file: every note and file, its assets, and Ironleaf’s settings and views for it. Keep it as a copy, or import it on another PC.</p>
          <div className="dialog-actions">
            <button className="button" onClick={onClose}>
              Cancel
            </button>
            <button className="button primary" onClick={() => void run()}>
              Choose where to save it…
            </button>
          </div>
        </>
      )}
      {step.kind === 'packing' && <Bar share={p && p.total ? p.done / p.total : 0} words={p && p.total ? `Packing · ${sizeWords(p.done)} of ${sizeWords(p.total)}` : 'Packing…'} />}
      {(step.kind === 'done' || step.kind === 'failed') && (
        <>
          <p className={`dialog-message${step.kind === 'failed' ? ' vp-failed' : ''}`}>{step.words}</p>
          <div className="dialog-actions">
            <button className="button primary" onClick={onClose}>
              Done
            </button>
          </div>
        </>
      )}
    </Shell>
  );
}
