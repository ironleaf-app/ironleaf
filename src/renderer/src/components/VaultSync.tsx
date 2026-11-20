// This PC's sync state for the open vault (24 Oct 2026, WS1 step 0; src/main/vault-sync.ts, src/shared/vault-sync.ts):
// the line in Settings › Files and links ("Up to date with Office-PC", "OneDrive paused", "3 files only in the cloud",
// "2 conflict copies") with its fixes, what lives where (in the vault, yours, this PC only), and Today's small status. The
// conflict copies open in a window that merges each into its note (every line kept) or keeps both.

import { useCallback, useEffect, useState } from 'react';
import type { BackupView } from '../../../shared/backup';
import { HOME_WORDS, type SettingHome } from '../../../shared/vault-settings';
import { agoWords, type ConflictCopy, type SyncFix, type SyncItem, type SyncTone, type SyncView } from '../../../shared/vault-sync';
import * as A from '../state/actions';
import { openModal } from '../state/modals';
import { showError, toast, useApp } from '../state/store';
import { errorMessage } from '../lib/errors';
import { Icon, type IconName } from './Icon';
import { LookRow } from './LookRow';
import { Shell } from './VaultHome';
import '../styles/vault-sync.css';

const api = () => window.nv.sync;
const CHANGED = 'nv-sync-changed';

/** This PC's sync state, read when the vault opens, when the window comes back, every two minutes, and after a fix. */
export function useSync(): { view: SyncView | null; refresh(fresh?: boolean): void } {
  const vaultPath = useApp((s) => s.vault?.path);
  const [view, setView] = useState<SyncView | null>(null);
  const refresh = useCallback((fresh = false) => {
    void api()
      .status(fresh)
      .then(setView, () => undefined);
  }, []);
  useEffect(() => {
    setView(null);
    const t = setTimeout(() => refresh(), 400);
    return () => clearTimeout(t);
  }, [vaultPath, refresh]);
  useEffect(() => {
    const again = () => refresh();
    const timer = setInterval(again, 120_000);
    window.addEventListener('focus', again);
    window.addEventListener(CHANGED, again);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', again);
      window.removeEventListener(CHANGED, again);
    };
  }, [refresh]);
  return { view, refresh };
}

const toneIcon = (tone: SyncTone, id: SyncItem['id']): IconName => (tone === 'ok' ? 'check' : id === 'cloud' ? 'cloud' : id === 'conflicts' ? 'copy' : id === 'place' ? 'computer' : tone === 'info' ? 'info' : 'warning');

/** A fix's button: the conflict copies open their window; the others run on the main side. */
function FixButton({ fix, primary, onConflicts }: { fix: SyncFix; primary?: boolean; onConflicts(): void }) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (fix.id === 'conflicts') return onConflicts();
    setBusy(true);
    try {
      const done = await api().fix(fix.id);
      toast(done.words);
      window.dispatchEvent(new Event(CHANGED));
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <button className={`button${primary ? ' primary' : ''}`} disabled={busy} onClick={() => void run()}>
      {busy ? 'Working…' : fix.label}
    </button>
  );
}

// ── Settings › Files and links ─────────────────────────────────────────────────────────────────────────────────────

export function VaultSyncSection() {
  const { view, refresh } = useSync();
  useEffect(() => refresh(true), [refresh]);
  const [conflicts, setConflicts] = useState(false);
  const [checking, setChecking] = useState(false);
  const again = async () => {
    setChecking(true);
    try {
      await api().status(true);
      refresh();
    } finally {
      setChecking(false);
    }
  };
  return (
    <>
      <h3>This PC’s sync</h3>
      {!view && <div className="vs-line is-loading">Looking at how this vault syncs…</div>}
      {view && (
        <div className="vs-card" data-sync={view.main.id}>
          <div className={`vs-line tone-${view.main.tone}`} data-section="vault-sync-line">
            <span className="vs-icon" aria-hidden="true">
              <Icon name={toneIcon(view.main.tone, view.main.id)} size={17} />
            </span>
            <div className="vs-words">
              <strong>
                {view.main.title} {view.main.tone === 'warn' && <span className="tag amber">At risk</span>}
              </strong>
              <span>{view.main.words}</span>
            </div>
            <div className="vs-acts">
              {view.main.fix && <FixButton fix={view.main.fix} primary onConflicts={() => setConflicts(true)} />}
              <button className="text-button" disabled={checking} onClick={() => void again()} title={`Looked ${agoWords(Date.now() - view.checkedAt)}`}>
                {checking ? 'Checking…' : 'Check again'}
              </button>
            </div>
          </div>
          {view.more.map((item) => (
            <div key={item.id} className={`vs-line small tone-${item.tone}`} data-sync-item={item.id}>
              <span className="vs-icon" aria-hidden="true">
                <Icon name={toneIcon(item.tone, item.id)} size={14} />
              </span>
              <div className="vs-words">
                <strong>{item.title}</strong>
                <span>{item.words}</span>
              </div>
              {item.fix && (
                <div className="vs-acts">
                  <FixButton fix={item.fix} onConflicts={() => setConflicts(true)} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <SharedHomes />
      {conflicts && view && <ConflictsDialog view={view} onClose={() => (setConflicts(false), refresh(true))} />}
    </>
  );
}

/** Where each kind of setting is kept, in plain words. */
function SharedHomes() {
  const homes: { home: SettingHome; icon: IconName }[] = [
    { home: 'vault', icon: 'vault' },
    { home: 'personal', icon: 'person' },
    { home: 'pc', icon: 'computer' },
  ];
  return (
    <div className="vs-homes" role="list" aria-label="Where settings are kept">
      {homes.map(({ home, icon }) => (
        <div key={home} className="vs-home" role="listitem" data-home={home}>
          <span className="vs-home-icon" aria-hidden="true">
            <Icon name={icon} size={15} />
          </span>
          <strong>{HOME_WORDS[home].title}</strong>
          <span>
            {HOME_WORDS[home].words}
            {home === 'personal' && ' They stay on this PC.'}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Today ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Today's small status: one quiet line when all is well, a card with its fix when something needs the person. */
export function VaultSyncToday() {
  const { view, refresh } = useSync();
  const [conflicts, setConflicts] = useState(false);
  // A vault only on this PC: Today's own card says so (components/VaultPlace.tsx, VaultHome.tsx).
  if (!view || view.place.kind === 'local') return null;
  const m = view.main;
  const note = view.more.find((i) => i.tone !== 'ok');
  if (m.tone === 'ok' || m.tone === 'info') {
    return (
      <div className={`vs-today quiet tone-${m.tone}`} data-section="vault-sync-today" role="status">
        <Icon name={toneIcon(m.tone, m.id)} size={13} />
        <span className="vs-today-title">{m.title}</span>
        {note && (
          <button className="vs-today-more" onClick={() => openModal({ kind: 'settings', section: 'files' })} title={note.words}>
            · {note.title}
          </button>
        )}
      </div>
    );
  }
  // Something needs the person: a row of the "things need a look" list, opening to this same card (8 Nov 2026,
  // calm Today). The quiet line above stays a line, never a counted row.
  return (
    <>
      <LookRow icon={toneIcon(m.tone, m.id)} title={m.title}>
        <section className={`td-section vs-today-card tone-${m.tone}`} data-section="vault-sync-today" aria-labelledby="vs-today-h">
          <span className="vs-icon" aria-hidden="true">
            <Icon name={toneIcon(m.tone, m.id)} size={17} />
          </span>
          <div className="vs-words">
            <h2 id="vs-today-h">{m.title}</h2>
            <p>{m.words}</p>
            <div className="vs-acts">
              {m.fix && <FixButton fix={m.fix} primary onConflicts={() => setConflicts(true)} />}
              <button className="text-button" onClick={() => openModal({ kind: 'settings', section: 'files' })}>
                Sync details
              </button>
            </div>
          </div>
        </section>
      </LookRow>
      {conflicts && <ConflictsDialog view={view} onClose={() => (setConflicts(false), refresh(true))} />}
    </>
  );
}

/** A backup that failed, as a row of the morning list (9 Nov 2026, break job: failures lived only in
 *  Settings, so a failure overnight never reached the morning. Vault health, first when it speaks. Only when
 *  switched on and failed; off is a choice, not a failure. Opens Settings where the fix lives. */
export function BackupToday() {
  const [view, setView] = useState<BackupView | null>(null);
  useEffect(() => {
    let live = true;
    if (!window.nv.backup) return () => void (live = false);
    void window.nv.backup.view().then((v) => live && setView(v), () => undefined);
    const off = window.nv.backup.onChange((v) => live && setView(v));
    return () => {
      live = false;
      off();
    };
  }, []);
  if (!view) return null;
  const fails: { title: string; words: string }[] = [];
  if (view.git.prefs.on && view.git.error) fails.push({ title: 'Git backup failed', words: view.git.error });
  if (view.sync.prefs.on && view.sync.error) fails.push({ title: 'Sync failed', words: view.sync.error });
  if (!fails.length) return null;
  const title = fails.length > 1 ? 'Backups failed' : fails[0].title;
  return (
    <LookRow icon="warning" title={title}>
      <section className="td-section vs-today-card tone-warn" data-section="vault-backup" aria-labelledby="vs-backup-h">
        <span className="vs-icon" aria-hidden="true">
          <Icon name="warning" size={17} />
        </span>
        <div className="vs-words">
          <h2 id="vs-backup-h">{title}</h2>
          {fails.map((f) => (
            <p key={f.title}>
              <strong>{f.title}.</strong> {f.words}
            </p>
          ))}
          <div className="vs-acts">
            <button className="button primary" onClick={() => A.openSettings('backups')}>
              Open Backups and sync
            </button>
          </div>
        </div>
      </section>
    </LookRow>
  );
}

// ── Conflict copies ─────────────────────────────────────────────────────────────────────────────────────────────────

const nameOf = (rel: string) => rel.split('/').pop() ?? rel;
const folderOf = (rel: string) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '');

function ConflictsDialog({ view, onClose }: { view: SyncView; onClose(): void }) {
  const [list, setList] = useState<ConflictCopy[]>(view.conflicts);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const one = async (c: ConflictCopy, how: 'merge' | 'keep-both') => {
    setBusy(c.copy);
    try {
      const r = await api().fix(how, c.copy);
      setDone(r.words);
      setList((l) => l.filter((x) => x.copy !== c.copy));
      window.dispatchEvent(new Event(CHANGED));
    } catch (err) {
      setDone(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };
  const all = async () => {
    setBusy('*');
    try {
      const r = await api().fix('merge-all');
      setDone(r.words);
      setList((l) => l.filter((x) => !x.note));
      window.dispatchEvent(new Event(CHANGED));
    } catch (err) {
      setDone(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };
  const notes = list.filter((c) => c.note).length;
  return (
    <Shell title={list.length ? 'Conflict copies' : 'No conflict copies left'} icon={list.length ? 'copy' : 'check'} onClose={onClose} locked={busy === '*'}>
      <p className="dialog-message">
        {list.length
          ? 'When a note is changed on two PCs before they sync, OneDrive keeps both: the second with the PC’s name added. Merge puts every line of the copy into the note (nothing is lost; the note keeps its own words at the top) and sends the copy to Recently deleted. Keep both gives the copy a name that says whose it is.'
          : 'Every copy is dealt with.'}
      </p>
      {done && (
        <p className="vs-done" role="status">
          <Icon name="check" size={13} /> {done}
        </p>
      )}
      {list.length > 0 && (
        <div className="vs-copies" role="list" aria-label="Conflict copies">
          {list.map((c) => (
            <div key={c.copy} className="vs-copy" role="listitem" data-copy={c.copy}>
              <span className="vs-copy-icon" aria-hidden="true">
                <Icon name={c.note ? 'notes' : 'file'} size={15} />
              </span>
              <div className="vs-copy-words">
                <strong title={c.copy}>{nameOf(c.copy)}</strong>
                <span>
                  {c.pc ? `${c.pc}’s version of ` : 'Another version of '}
                  <em title={c.original}>{nameOf(c.original)}</em>
                  {folderOf(c.original) ? ` in ${folderOf(c.original)}` : ''}
                </span>
              </div>
              <div className="vs-acts">
                {c.note && (
                  <button className="button" disabled={!!busy} onClick={() => void one(c, 'merge')}>
                    Merge
                  </button>
                )}
                <button className="text-button" disabled={!!busy} onClick={() => void one(c, 'keep-both')}>
                  Keep both
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="dialog-actions">
        <button className="button" onClick={onClose} disabled={busy === '*'}>
          {list.length ? 'Close' : 'Done'}
        </button>
        {notes > 1 && (
          <button className="button primary" disabled={!!busy} onClick={() => void all()}>
            {busy === '*' ? 'Merging…' : `Merge all ${notes} notes`}
          </button>
        )}
      </div>
    </Shell>
  );
}
