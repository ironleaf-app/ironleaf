// Notes from another app (V9, 28 Oct 2026; src/main/pairing): Settings › Files and links › Import… › From another app,
// and the Paired sources list under Your vaults. Pick the app, see how to get its export, choose the file or folder,
// see what comes in and where, then bring it in. A source brought in before can be brought in again from a newer
// export: notes you changed are kept, and where the app changed one too its words go beside yours, with the
// difference shown here.

import { useEffect, useState } from 'react';
import { LIVE_HOW, SOURCE_APPS, SOURCE_HOW, SOURCE_KINDS, type LiveKind, type PairListed, type PairPlan, type PairProgress, type PairSummary, type SourceKind, type FileKind } from '../../../shared/pairing/types';
import { errorMessage } from '../lib/errors';
import { openPath } from '../state/actions';
import { closeModal } from '../state/modals';
import { showError } from '../state/store';
import { ChangeRows } from './Extras';
import { Icon } from './Icon';
import { Shell } from './VaultHome';

const api = () => window.nv.pairing;
/** A note opened from the dialog: Settings closes so it shows. */
const openNote = (rel: string) => {
  closeModal();
  openPath(rel, { reuse: true });
};

const ICON: Record<SourceKind, Parameters<typeof Icon>[0]['name']> = { evernote: 'notes', notion: 'board', keep: 'bulb', readwise: 'book', logseq: 'outline', roam: 'graph', todoist: 'task' };

/** The apps, as a list to pick from (inside Import…). */
export function SourceChoices({ onPick }: { onPick(kind: FileKind): void }) {
  return (
    <div className="vp-targets pair-apps" role="list" aria-label="Apps to bring notes from">
      {SOURCE_KINDS.map((k) => (
        <button key={k} className="vp-target" role="listitem" data-source={k} onClick={() => onPick(k)}>
          <span className="vp-target-icon">
            <Icon name={ICON[k]} size={17} />
          </span>
          <span className="vp-target-words">
            <span className="vp-target-label">{SOURCE_APPS[k]}</span>
            <span className="vp-target-path">{SOURCE_HOW[k].what}</span>
          </span>
          <Icon name="forward" size={14} className="vp-faint" />
        </button>
      ))}
    </div>
  );
}

type Step = { kind: 'how' } | { kind: 'reading' } | { kind: 'plan'; plan: PairPlan } | { kind: 'bringing'; plan: PairPlan } | { kind: 'done'; summary: PairSummary } | { kind: 'failed'; words: string };

/** Bring notes in from one app: how to get its export, choose it, see what comes in, bring it in. */
export function PairDialog({ source, onClose }: { source: FileKind; onClose(): void }) {
  const [step, setStep] = useState<Step>({ kind: 'how' });
  const [progress, setProgress] = useState<PairProgress | null>(null);
  const app = SOURCE_APPS[source];
  const how = SOURCE_HOW[source];
  const close = () => {
    if (step.kind === 'plan') void api().cancel();
    onClose();
  };
  const choose = async (mode?: 'file' | 'folder') => {
    setStep({ kind: 'reading' });
    try {
      const plan = await api().pick(source, mode);
      setStep(plan ? { kind: 'plan', plan } : { kind: 'how' });
    } catch (err) {
      setStep({ kind: 'failed', words: errorMessage(err) });
    }
  };
  const bring = async (plan: PairPlan) => {
    setStep({ kind: 'bringing', plan });
    setProgress(null);
    const off = api().onProgress(setProgress);
    try {
      setStep({ kind: 'done', summary: await api().bring() });
    } catch (err) {
      setStep({ kind: 'failed', words: errorMessage(err) });
    } finally {
      off();
    }
  };
  const busy = step.kind === 'reading' || step.kind === 'bringing';
  return (
    <Shell title={step.kind === 'done' ? `Brought in from ${app}` : `Bring in from ${app}`} icon={step.kind === 'done' ? 'check' : ICON[source]} onClose={close} locked={busy}>
      {step.kind === 'how' && (
        <>
          <p className="dialog-message">{how.how}</p>
          <p className="vp-note">
            <Icon name="info" size={13} /> Each note keeps where it came from. Bring the same export in again later and notes you changed here are never overwritten.
          </p>
          <div className="dialog-actions">
            {how.pick === 'either' && (
              <button className="button" onClick={() => void choose('folder')}>
                Choose a folder…
              </button>
            )}
            {(source === 'evernote' || source === 'readwise') && (
              <button className="button" onClick={() => void choose('folder')}>
                A folder of them…
              </button>
            )}
            <button className="button primary" onClick={() => void choose()}>
              {how.pick === 'folder' ? 'Choose the folder…' : 'Choose the file…'}
            </button>
          </div>
        </>
      )}
      {step.kind === 'reading' && <Waiting words="Looking at what’s there…" />}
      {step.kind === 'plan' && (
        <>
          <p className="dialog-message">{step.plan.words}</p>
          {step.plan.sample.length > 0 && (
            <ul className="pair-sample" aria-label="Some of the notes">
              {step.plan.sample.map((t, i) => (
                <li key={`${t}:${i}`}>
                  <Icon name="file" size={13} /> {t}
                </li>
              ))}
              {step.plan.notes + step.plan.daily > step.plan.sample.length && <li className="pair-more">and {(step.plan.notes + step.plan.daily - step.plan.sample.length).toLocaleString('en-AU')} more</li>}
            </ul>
          )}
          <p className="vp-note">
            <Icon name="history" size={13} /> Notes here that change are kept in File recovery first.
          </p>
          <div className="dialog-actions">
            <button className="button" onClick={close}>
              Cancel
            </button>
            <button className="button primary" onClick={() => void bring(step.plan)}>
              Bring in
            </button>
          </div>
        </>
      )}
      {step.kind === 'bringing' && <Bringing plan={step.plan} app={app} progress={progress} onStop={() => void api().cancel()} />}
      {step.kind === 'done' && <Done summary={step.summary} onClose={onClose} />}
      {step.kind === 'failed' && (
        <>
          <p className="dialog-message vp-failed">{step.words}</p>
          <div className="dialog-actions">
            <button className="button" onClick={onClose}>
              Close
            </button>
            <button className="button primary" onClick={() => setStep({ kind: 'how' })}>
              Try again
            </button>
          </div>
        </>
      )}
    </Shell>
  );
}

function Waiting({ words }: { words: string }) {
  return (
    <div className="vp-progress" aria-live="polite">
      <div className="vp-bar is-busy" role="progressbar" aria-busy="true">
        <span />
      </div>
      <p className="vp-phase">{words}</p>
    </div>
  );
}

const PHASE_WORDS: Record<PairProgress['phase'], string> = { indexing: 'Looking at your notes', notes: 'Bringing notes in', files: 'Bringing pictures and files in', views: 'Making views' };

/** Bringing in with its share and a Stop (F1): stopping finishes the note and keeps what came in. */
function Bringing({ plan, app, progress, onStop }: { plan: PairPlan; app: string; progress: PairProgress | null; onStop(): void }) {
  const total = plan.notes + plan.daily;
  const known = progress && progress.total > 0;
  const words = progress ? `${PHASE_WORDS[progress.phase]}…${known ? ` ${Math.min(progress.done + 1, progress.total).toLocaleString('en-AU')} of ${progress.total.toLocaleString('en-AU')}` : ''}` : `Bringing in ${total} notes from ${app}…`;
  const pct = known ? Math.round((progress.done / progress.total) * 100) : 0;
  return (
    <div className="vp-progress" aria-live="polite">
      <div className={`vp-bar${known ? '' : ' is-busy'}`} role="progressbar" aria-busy={!known} aria-valuenow={known ? pct : undefined} aria-valuemin={0} aria-valuemax={100} aria-label={words}>
        <span style={known ? { width: `${pct}%` } : undefined} />
      </div>
      <p className="vp-phase">{words}</p>
      <div className="dialog-actions">
        <button className="button" onClick={onStop}>
          Stop
        </button>
      </div>
    </div>
  );
}

/** The two versions without the lines the import keeps for itself (when it came in, which copy it is), so the difference
 *  shown is the words. */
const bookkeeping = (text: string) => text.replace(/^(imported|synced|conflict-of):.*\r?\n/gm, '');

function Done({ summary, onClose }: { summary: PairSummary; onClose(): void }) {
  const [open, setOpen] = useState<string | null>(null);
  const [texts, setTexts] = useState<Record<string, { mine: string; theirs: string }>>({});
  const [undone, setUndone] = useState<string | null>(null);
  const undo = async () => {
    try {
      const back = await api().undoPair(summary.pairId);
      setUndone(back.words);
    } catch (err) {
      showError(err);
    }
  };
  const show = async (rel: string, copy: string) => {
    if (open === copy) return setOpen(null);
    setOpen(copy);
    if (!texts[copy]) {
      try {
        const both = await api().compare(rel, copy);
        setTexts((t) => ({ ...t, [copy]: both }));
      } catch (err) {
        showError(err);
      }
    }
  };
  const first = summary.written[0];
  return (
    <>
      <p className="dialog-message">{summary.words}</p>
      {summary.conflicts.length > 0 && (
        <div className="pair-conflicts" role="list" aria-label="Changed in both places">
          {summary.conflicts.map((c) => (
            <div key={c.copy} className="pair-conflict" role="listitem">
              <div className="pair-conflict-head">
                <Icon name="merge" size={14} />
                <button className="text-button" onClick={() => (onClose(), openNote(c.rel))}>
                  {c.rel.split('/').pop()!.replace(/\.md$/i, '')}
                </button>
                <button className="text-button pair-diff-toggle" onClick={() => void show(c.rel, c.copy)}>
                  {open === c.copy ? 'Hide the difference' : 'Show the difference'}
                </button>
              </div>
              {open === c.copy && texts[c.copy] && (
                <>
                  <p className="hint">Yours is kept as it is. Lines marked + are {summary.app}’s, in its copy beside yours.</p>
                  <ChangeRows before={bookkeeping(texts[c.copy].mine)} after={bookkeeping(texts[c.copy].theirs)} />
                  <button className="text-button" onClick={() => (onClose(), openNote(c.copy))}>
                    Open {summary.app}’s copy
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
      {summary.skipped.length > 0 && (
        <div className="pair-skipped" role="list" aria-label="Left out, and why">
          <div className="glabel">Left out, and why</div>
          {summary.skipped.slice(0, 10).map((s, i) => (
            <div key={`${s.what}-${i}`} className="pair-skip" role="listitem">
              <span className="nm">{s.what}</span>
              <span className="hint">{s.why}</span>
            </div>
          ))}
          {summary.skipped.length > 10 && <p className="hint">And {summary.skipped.length - 10} more.</p>}
        </div>
      )}
      {undone && <p className="dialog-message">{undone}</p>}
      <div className="dialog-actions">
        {first && !undone && (
          <button className="button" onClick={() => (onClose(), openNote(first))}>
            Open the first note
          </button>
        )}
        {summary.undoable && summary.undoable.notes > 0 && !undone && (
          <button className="button" onClick={() => void undo()}>
            Undo
          </button>
        )}
        <button className="button primary" onClick={onClose}>
          Done
        </button>
      </div>
    </>
  );
}

const LIVE_KINDS: LiveKind[] = ['notion', 'todoist'];

/** Keep Notion or Todoist in step with your own token (V10, V11). The token is kept in this app's secret store on
 *  this PC, never in your notes, and it is never shown again after you paste it. */
export function LivePairingSection({ refreshKey, onChanged }: { refreshKey: number; onChanged(): void }) {
  const [saved, setSaved] = useState<Record<LiveKind, boolean> | null>(null);
  const [tokens, setTokens] = useState<Record<LiveKind, string>>({ notion: '', todoist: '' });
  const [busy, setBusy] = useState<LiveKind | null>(null);
  const [words, setWords] = useState<Record<LiveKind, string>>({ notion: '', todoist: '' });
  const [held, setHeld] = useState<Record<LiveKind, { check: string; fresh: number } | null>>({ notion: null, todoist: null });
  const load = () => void api().liveStatus().then(setSaved, () => setSaved({ notion: false, todoist: false }));
  useEffect(load, [refreshKey]);
  const run = async (kind: LiveKind, fn: () => Promise<unknown>, done: string) => {
    setBusy(kind);
    try {
      const out = (await fn()) as PairSummary | undefined;
      setWords((w) => ({ ...w, [kind]: out?.words ?? done }));
      setHeld((h) => ({ ...h, [kind]: out?.held && out.check ? { check: out.check, fresh: out.fresh ?? 0 } : null }));
      setTokens((t) => ({ ...t, [kind]: '' }));
      load();
      onChanged();
    } catch (err) {
      setWords((w) => ({ ...w, [kind]: errorMessage(err) }));
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      <h3>Kept in step</h3>
      <p className="vh-lead">Notion and Todoist can stay in step with your notes here. Changes in the other app come in, and changes you make here go back. Where both changed, yours is kept and theirs is put beside it, never overwritten quietly.</p>
      {LIVE_KINDS.map((kind) => (
        <div key={kind} className="vh-vault pair-source" data-live={kind}>
          <span className="vh-vault-icon" aria-hidden="true">
            <Icon name={ICON[kind]} size={18} />
          </span>
          <div className="vh-vault-words">
            <div className="vh-vault-name">
              <span>{SOURCE_APPS[kind]}</span>
              <span className="vh-faint">{saved?.[kind] ? 'Connected on this PC' : 'Not connected'}</span>
            </div>
            <div className="vh-vault-path">{LIVE_HOW[kind].steps}</div>
            {!saved?.[kind] && (
              <label className="pair-token">
                <span>{LIVE_HOW[kind].get}</span>
                <input type="password" autoComplete="off" value={tokens[kind]} onChange={(e) => setTokens((t) => ({ ...t, [kind]: e.target.value }))} placeholder="Paste your token" aria-label={`${SOURCE_APPS[kind]} token`} />
              </label>
            )}
            {words[kind] && <div className="vh-vault-meta">{words[kind]}</div>}
          </div>
          <div className="vh-actions">
            {saved?.[kind] ? (
              <>
                {held[kind] ? (
                  <button className="button primary" disabled={busy === kind} onClick={() => void run(kind, () => api().liveSync(kind, held[kind]!.check), 'In step.')}>
                    Bring in {held[kind]!.fresh} {held[kind]!.fresh === 1 ? 'note' : 'notes'}
                  </button>
                ) : (
                  <button className="button primary" disabled={busy === kind} onClick={() => void run(kind, () => api().liveSync(kind), 'In step.')}>
                    Bring in and send back
                  </button>
                )}
                <button className="button" disabled={busy === kind} onClick={() => void run(kind, () => api().liveDisconnect(kind), 'Disconnected. Your notes stay as they are.')}>
                  Disconnect
                </button>
              </>
            ) : (
              <button className="button primary" disabled={busy === kind || !tokens[kind].trim()} onClick={() => void run(kind, () => api().liveConnect(kind, tokens[kind]), 'Connected.')}>
                Connect
              </button>
            )}
          </div>
        </div>
      ))}
      <p className="vp-note">
        <Icon name="info" size={13} /> Your token is kept in this app's secret store on this PC. It never goes into your notes or any file, and it is never shown again. Disconnecting takes the token out and leaves every note that came in exactly as it is.
      </p>
    </>
  );
}

/** Settings › Files and links: the sources brought into this vault, each with Bring in again. */
export function PairedSourcesSection({ refreshKey, onAgain }: { refreshKey: number; onAgain(kind: FileKind): void }) {
  const [pairs, setPairs] = useState<PairListed[] | null>(null);
  const load = () =>
    void api()
      .list()
      .then(setPairs, () => setPairs([]));
  useEffect(load, [refreshKey]);
  if (!pairs?.length) return null;
  return (
    <>
      <h3>Paired sources</h3>
      <p className="vh-lead">Notes brought in from other apps. Each knows where it came from, so bringing a newer export in again never overwrites what you changed here.</p>
      <div className="vh-list" role="list" aria-label="Paired sources">
        {pairs.map((p) => (
          <PairRow key={p.id} pair={p} onAgain={onAgain} reload={load} />
        ))}
      </div>
    </>
  );
}

function PairRow({ pair: p, onAgain, reload }: { pair: PairListed; onAgain(kind: FileKind): void; reload(): void }) {
  const [held, setHeld] = useState<{ check: string; fresh: number } | null>(null);
  const [words, setWords] = useState('');
  const live = p.live && (p.kind === 'notion' || p.kind === 'todoist');
  const sync = async (confirmed?: string) => {
    try {
      const out = await api().liveSync(p.kind as LiveKind, confirmed);
      setWords(out.words);
      setHeld(out.held && out.check ? { check: out.check, fresh: out.fresh ?? 0 } : null);
      reload();
    } catch (err) {
      showError(err);
    }
  };
  const undo = async () => {
    try {
      const back = await api().undoPair(p.id);
      setWords(back.words);
      setHeld(null);
      reload();
    } catch (err) {
      showError(err);
    }
  };
  return (
    <div className="vh-vault pair-source" role="listitem" data-pair={p.id}>
      <span className="vh-vault-icon" aria-hidden="true">
        <Icon name={ICON[p.kind] ?? 'inbox'} size={18} />
      </span>
      <div className="vh-vault-words">
        <div className="vh-vault-name">
          <span>{p.app}</span>
          {p.name && p.name !== p.app && <span className="vh-faint">{p.name}</span>}
          {p.paused && <span className="vh-faint">Paused</span>}
        </div>
        <div className="vh-vault-path" title={p.into}>
          Into {p.into}
        </div>
        <div className="vh-vault-meta">
          <span className="vh-faint">
            {p.notes.toLocaleString('en-AU')} {p.notes === 1 ? 'note' : 'notes'} · last brought in {new Date(p.lastRun).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })} from {p.sourceFile}
          </span>
        </div>
        {words && <div className="vh-vault-meta">{words}</div>}
      </div>
      <div className="vh-actions">
        {live ? (
          held ? (
            <button className="button primary" onClick={() => void sync(held.check)}>
              Bring in {held.fresh} {held.fresh === 1 ? 'note' : 'notes'}
            </button>
          ) : (
            <button className="button primary" onClick={() => void sync()}>
              Bring in and send back
            </button>
          )
        ) : (
          <button className="button" onClick={() => onAgain(p.kind as FileKind)}>
            Bring in again…
          </button>
        )}
        {p.undoable && p.undoable.notes > 0 && (
          <button className="button" onClick={() => void undo()}>
            Undo
          </button>
        )}
        <button className="button" onClick={() => void api().setPaused(p.id, !p.paused).then(reload, showError)}>
          {p.paused ? 'Resume' : 'Pause'}
        </button>
        <button className="button" onClick={() => void api().disconnect(p.id).then(reload, showError)}>
          Disconnect
        </button>
      </div>
    </div>
  );
}
