// Settings › Privacy and secrets (Wave 4, 24 Oct 2026; the plan: "Each agent gets explicit access per level (e.g. Chief:
// Work + Personal; Coach: Health; nobody: Family-private photos unless Jesse allows each use)"). Who may read which level
// — every outside agent — as ticks in one table; how Family-private photos are asked for; the level each area of life (a
// folder at the top) and each note type gives what's inside it; Secrets and the scanner; Private notes sorted into
// levels; the audit trail. Everything is kept in the vault (.neuralvault/sensitivity.json), so every PC decides the same
// (src/main/sensitive.ts).

import { useEffect, useMemo, useRef, useState } from 'react';
import type { AgentRow, MigrationNote, MigrationResult, PrivacyState } from '../../../shared/secrets';
import { LEVELS, levelLabel, type Level } from '../../../shared/sensitivity';
import { errorMessage } from '../lib/errors';
import * as A from '../state/actions';
import { loadPrivacyState, privacyStateChanged, usePrivacy } from '../state/privacy';
import { closeModal } from '../state/modals';
import { savePrefs, showError, toast, useApp, usePrefs } from '../state/store';
import { PRIVATE_LOCK_MINUTES, SECRETS_KEEP_UNLOCKED, type SecretsKeepUnlocked } from '../../../shared/prefs';
import { Icon } from './Icon';
import { LEVEL_ICON, LevelMark } from './LevelPicker';
import { LearnMore, Row, Segmented, Toggle } from './Settings';

function LevelSelect({ value, onChange, none = 'No level of its own', disabled }: { value: Level | null; onChange(v: Level | null): void; none?: string; disabled?: boolean }) {
  return (
    <select className={`setting-input ps-select${value ? ` lv-${value}` : ''}`} value={value ?? ''} disabled={disabled} onChange={(e) => onChange((e.target.value || null) as Level | null)}>
      <option value="">{none}</option>
      {LEVELS.map((l) => (
        <option key={l.id} value={l.id}>
          {l.label}
        </option>
      ))}
    </select>
  );
}

function AccessTable({ rows, onSet }: { rows: AgentRow[]; onSet(id: string, levels: Level[] | null): void }) {
  const canEdit = useApp((s) => s.canEdit);
  const parentRow = (r: AgentRow) => rows.find((x) => x.id === r.parent);
  return (
    <div className="ps-access" role="table" aria-label="Who may read each level">
      <div className="ps-access-row head" role="row">
        <span role="columnheader" className="ps-who-head">
          Assistant or agent
        </span>
        {LEVELS.map((l) => (
          <span key={l.id} role="columnheader" className={`ps-level-head lv-${l.id}`} title={l.words}>
            <Icon name={LEVEL_ICON[l.id]} size={13} />
            {l.short}
          </span>
        ))}
      </div>
      {rows.map((r) => {
        const follows = !r.group && !r.own;
        const parent = parentRow(r);
        return (
          <div key={r.id} className={`ps-access-row${r.group ? ' is-group' : ' is-member'}${follows ? ' is-following' : ''}`} role="row">
            <span className="ps-who" role="cell">
              <strong>{r.label}</strong>
              <span className="ps-who-words">
                {follows ? `Follows ${parent?.label ?? 'its group'}` : r.words}
                {!r.group && canEdit && (
                  <button className="ps-link" onClick={() => onSet(r.id, follows ? r.levels : null)}>
                    {follows ? 'Set its own' : `Follow ${parent?.label ?? 'its group'} again`}
                  </button>
                )}
              </span>
            </span>
            {LEVELS.map((l) => {
              const on = r.levels.includes(l.id);
              const fixed = l.id === 'open';
              return (
                <span key={l.id} className="ps-cell" role="cell" data-level={l.short}>
                  <input
                    type="checkbox"
                    className="ps-tick"
                    aria-label={`${r.label} reads ${l.label}`}
                    checked={on}
                    disabled={!canEdit || fixed || follows}
                    title={fixed ? 'Open is always readable' : follows ? `Set by ${parent?.label}` : `${on ? 'Reads' : 'Doesn’t read'} ${l.label}`}
                    onChange={(e) => onSet(r.id, e.target.checked ? [...r.levels, l.id] : r.levels.filter((x) => x !== l.id))}
                  />
                </span>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function Migration({ count, onDone }: { count: number; onDone(): void }) {
  const canEdit = useApp((s) => s.canEdit);
  const box = useRef<HTMLDivElement>(null);
  const [plan, setPlan] = useState<MigrationNote[] | null>(null);
  const [choice, setChoice] = useState<Record<string, { level: Level | 'keep'; destination: string }>>({});
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState('');
  const [result, setResult] = useState<MigrationResult | null>(null);
  useEffect(() => {
    window.nv.migrate.plan().then(
      (p) => {
        setPlan(p);
        setChoice(Object.fromEntries(p.map((n) => [n.path, { level: n.suggested, destination: n.destination }])));
      },
      (err) => setSaid(errorMessage(err)),
    );
  }, []);
  const moving = plan?.filter((n) => choice[n.path]?.level !== 'keep').length ?? 0;
  // Opened below the fold: brought into view.
  useEffect(() => {
    box.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [plan, result]);
  const run = async () => {
    if (!plan) return;
    setBusy(true);
    setSaid('');
    try {
      const r = await window.nv.migrate.run(plan.map((n) => (choice[n.path].level === 'keep' ? { path: n.path, keep: true } : { path: n.path, level: choice[n.path].level as Level, destination: choice[n.path].destination })));
      setResult(r);
      toast(`Moved ${r.moved} ${r.moved === 1 ? 'note' : 'notes'} into the vault with their levels${r.secrets ? `; ${r.secrets} ${r.secrets === 1 ? 'secret' : 'secrets'} into Secrets` : ''}.`);
    } catch (err) {
      setSaid(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  if (result)
    return (
      <div className="ps-migrate" ref={box}>
        <p className="ps-migrate-done">
          <Icon name="check" size={14} /> Moved {result.moved} {result.moved === 1 ? 'note' : 'notes'}
          {result.kept ? `, kept ${result.kept} locked` : ''}
          {result.secrets ? `, and ${result.secrets} ${result.secrets === 1 ? 'secret' : 'secrets'} found in them went into Secrets` : ''}. Each one was read back before its locked copy went to the Bin.
        </p>
        <ul className="ps-placed">
          {result.placed.map((p) => (
            <li key={p.to}>
              <LevelMark level={p.level} />
              <button className="ps-link" onClick={() => (closeModal(), A.openPath(p.to, { where: 'tab' }))}>
                {p.to}
              </button>
            </li>
          ))}
        </ul>
        {result.problems.map((p) => (
          <p key={p} className="pv-said">
            {p}
          </p>
        ))}
        <button className="button ps-done" onClick={onDone}>
          Done
        </button>
      </div>
    );
  return (
    <div className="ps-migrate" ref={box}>
      <p className="setting-hint">
        Each Private note can move into your notes with a level, so the assistants you allow can use it, or stay locked where no agent ever reaches it. Passwords and codes found in a note move into Secrets first, a locked link left in their place. Nothing is lost: each note is read back before its locked copy goes to the Bin.
      </p>
      {said && <p className="pv-said">{said}</p>}
      {!plan ? (
        !said && <div className="view-loading" />
      ) : plan.length === 0 ? (
        <p className="setting-hint">No private notes to sort.</p>
      ) : (
        <>
          <div className="ps-migrate-list">
            {plan.map((n) => {
              const c = choice[n.path];
              return (
                <div key={n.path} className="ps-migrate-row">
                  <span className="ps-migrate-name">
                    <Icon name="lock" size={12} /> {n.title}
                    {n.secrets > 0 && <em>{n.secrets === 1 ? '1 secret inside' : `${n.secrets} secrets inside`}</em>}
                  </span>
                  <select className="setting-input ps-select" value={c.level} onChange={(e) => setChoice((x) => ({ ...x, [n.path]: { ...c, level: e.target.value as Level | 'keep' } }))}>
                    <option value="keep">Keep locked</option>
                    {LEVELS.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.label}
                      </option>
                    ))}
                  </select>
                  <input className="setting-input ps-dest" value={c.destination} disabled={c.level === 'keep'} aria-label={`Where ${n.title} goes`} onChange={(e) => setChoice((x) => ({ ...x, [n.path]: { ...c, destination: e.target.value } }))} />
                </div>
              );
            })}
          </div>
          <div className="ps-migrate-actions">
            <button className="button" onClick={onDone}>
              Cancel
            </button>
            <button className="button primary" disabled={!canEdit || busy || !moving} onClick={() => void run()}>
              {busy ? 'Moving…' : moving ? `Move ${moving} ${moving === 1 ? 'note' : 'notes'}` : 'Nothing to move'}
            </button>
          </div>
        </>
      )}
      {count > 0 && !plan && said && (
        <button className="button" onClick={() => (closeModal(), A.openLocked('notes'))}>
          Open Locked to unlock it
        </button>
      )}
    </div>
  );
}

export function PrivacySettings() {
  const { state: kept } = usePrivacy();
  const prefs = usePrefs();
  const canEdit = useApp((s) => s.canEdit);
  const [state, setState] = useState<PrivacyState | null>(kept);
  const [sorting, setSorting] = useState(false);
  useEffect(() => {
    void loadPrivacyState().then((s) => s && setState(s));
  }, []);
  useEffect(() => {
    if (kept) setState(kept);
  }, [kept]);
  const act = async (fn: () => Promise<PrivacyState>) => {
    try {
      const next = await fn();
      setState(next);
      privacyStateChanged(next);
    } catch (err) {
      showError(err);
    }
  };
  const suggestions = useMemo(() => (state?.folders ?? []).filter((f) => f.suggested && !f.level), [state]);
  if (!state) return <div className="view-loading" />;
  const total = LEVELS.reduce((n, l) => n + (state.counts[l.id] ?? 0), 0);
  return (
    <div className="ps">
      <p className="ps-lede">
        Every note, file and asset has a level. Each assistant and agent reads only the levels ticked for it here.{' '}
        <LearnMore>What it isn’t allowed never reaches it, not through search, related notes, the connected vault or anything else. Secrets are never readable by any of them.</LearnMore>
      </p>
      <div className="ps-counts" aria-label="How many things carry each level">
        {LEVELS.map((l) => (
          <span key={l.id} className={`ps-count lv-${l.id}`}>
            <Icon name={LEVEL_ICON[l.id]} size={12} />
            {l.label}
            <strong>{(state.counts[l.id] ?? 0).toLocaleString('en-AU')}</strong>
          </span>
        ))}
        <span className="ps-count-total">{total.toLocaleString('en-AU')} in all</span>
      </div>

      <h3>Who may read what</h3>
      <AccessTable rows={state.rows} onSet={(id, levels) => void act(() => window.nv.privacy.setAccess(id, levels))} />
      <p className="setting-hint ps-under">A bot or outside agent follows its group until you set its own.</p>

      <Row title="Family-private photos" hint="A photo or video marked Family-private is used only with your OK each time, on a card like other requests: even an agent allowed Family-private asks.">
        <Segmented value={state.photos} options={[{ id: 'ask', label: 'Ask me each time' }, { id: 'never', label: 'Never' }]} onChange={(rule) => void act(() => window.nv.privacy.setPhotos(rule))} />
      </Row>

      <h3>Areas and folders</h3>
      <p className="setting-hint ps-under">A folder’s level is what everything in it has unless a note or file says its own.</p>
      {suggestions.length > 0 && (
        <div className="ps-suggest">
          <span>
            <Icon name="bulb" size={13} /> {suggestions.map((f) => `${f.folder} as ${levelLabel(f.suggested!)}`).join(', ')}
          </span>
          <button className="button small" disabled={!canEdit} onClick={() => void (async () => {
            for (const f of suggestions) await window.nv.privacy.setFolder(f.folder, f.suggested!);
            await act(() => window.nv.privacy.state());
            toast('The suggested levels are set. Change any of them below.');
          })().catch(showError)}>
            Use these
          </button>
        </div>
      )}
      <div className="ps-folders">
        {state.folders.length === 0 && <p className="setting-hint">No folders yet.</p>}
        {state.folders.map((f) => (
          <div key={f.folder} className="ps-folder">
            <span className="ps-folder-name">
              <Icon name="folder" size={13} /> {f.folder}
              <em>{f.notes === 1 ? '1 note' : `${f.notes} notes`}</em>
            </span>
            <LevelSelect value={f.level} disabled={!canEdit} none={f.suggested ? `None (usually ${levelLabel(f.suggested)})` : 'No level of its own'} onChange={(v) => void act(() => window.nv.privacy.setFolder(f.folder, v))} />
          </div>
        ))}
      </div>

      {state.types.length > 0 && (
        <>
          <h3>Note types</h3>
          <p className="setting-hint ps-under">A type’s level is what its notes have, wherever they are, unless a note says its own.</p>
          <div className="ps-folders">
            {state.types.map((t) => (
              <div key={t.id} className="ps-folder">
                <span className="ps-folder-name">{t.name}</span>
                <LevelSelect value={t.level} disabled={!canEdit} none="As its folder says" onChange={(v) => void act(() => window.nv.privacy.setType(t.id, v))} />
              </div>
            ))}
          </div>
        </>
      )}

      <h3>Secrets</h3>
      <Row title="Secrets" hint="Passwords, passcodes, licence keys and ID numbers, locked in your vault and never sent to any agent. A note links to one without holding it.">
        <button className="button primary" onClick={() => (closeModal(), A.openLocked('secrets'))}>
          <Icon name="key" size={14} /> Open Locked
        </button>
      </Row>
      <Row title="Stay unlocked for" hint={SECRETS_KEEP_UNLOCKED.find((o) => o.id === prefs.secretsKeepUnlocked)?.hint}>
        <select className="setting-input" value={prefs.secretsKeepUnlocked} disabled={!canEdit} onChange={(e) => void savePrefs({ secretsKeepUnlocked: e.target.value as SecretsKeepUnlocked, secretsKeepUnlockedChosen: true })}>
          {SECRETS_KEEP_UNLOCKED.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </Row>
      {prefs.secretsKeepUnlocked === 'strict' && (
        <Row title="Ask again after" hint="With no use at all. Reading the page counts as use, so it will not lock while you are reading it.">
          <select className="setting-input" value={prefs.privateLockMinutes} disabled={!canEdit} onChange={(e) => void savePrefs({ privateLockMinutes: Number(e.target.value) })}>
            {PRIVATE_LOCK_MINUTES.map((m) => (
              <option key={m} value={m}>
                {m === 0 ? 'Only when Ironleaf closes' : `${m} minutes`}
              </option>
            ))}
          </select>
        </Row>
      )}
      <Row title="Lock when Windows locks or this PC sleeps" hint="Off unless you turn it on: locking Windows or sleep leaves Locked as it is. Signing out of Windows always locks it.">
        <Toggle value={prefs.secretsLockOnWindowsLock} label="Lock when Windows locks or this PC sleeps" onChange={(v) => void savePrefs({ secretsLockOnWindowsLock: v })} />
      </Row>
      <p className="setting-hint ps-under">Unlock once on each PC. Inside that time, restarting Ironleaf, an update, locking Windows and sleep do not ask again. Signing out of Windows, the time running out, switching to the strict minutes and Lock now lock straight away. Bank details, cards, private keys and keys for other services still ask for Windows Hello (or your recovery password) each time you show or copy one, and that check lasts 5 minutes. Using a login, such as checking a machine with it or copying a plain login, never asks.</p>
      <Row title="Find secrets in notes" hint="Looks for passwords, passcodes, card numbers and keys already written in your notes, and offers to move each into Secrets, with Undo.">
        <button className="button" onClick={() => (closeModal(), A.openLocked('scan'))}>
          <Icon name="search" size={14} /> Look now
        </button>
      </Row>
      <h3>Private notes</h3>
      <Row
        title="Private notes"
        hint={
          state.privateNotes.exists
            ? `${state.privateNotes.unlocked ? `${state.privateNotes.count} private ${state.privateNotes.count === 1 ? 'note' : 'notes'}` : 'Your private notes'} stay locked where no agent reaches them.`
            : 'No private notes in this vault yet. Set them up with a recovery password.'
        }
      >
        <button className="button" onClick={() => (closeModal(), A.openLocked('notes'))}>
          <Icon name="lock" size={14} /> Open
        </button>
      </Row>
      <Row
        title="Private notes into levels"
        hint={
          state.privateNotes.exists
            ? `Sort them into levels so the assistants you allow can use them.${state.privateNotes.migrated ? ` ${state.privateNotes.migrated.notes} moved so far.` : ''}`
            : 'No private notes in this vault.'
        }
      >
        {state.privateNotes.exists &&
          (state.privateNotes.unlocked ? (
            <button className="button" disabled={!canEdit} onClick={() => setSorting((v) => !v)}>
              {sorting ? 'Close' : 'Sort into levels…'}
            </button>
          ) : (
            <button className="button" onClick={() => (closeModal(), A.openLocked('notes'))}>
              <Icon name="lock" size={14} /> Unlock it first
            </button>
          ))}
      </Row>
      {sorting && <Migration count={state.privateNotes.count} onDone={() => (setSorting(false), void act(() => window.nv.privacy.state()))} />}
      <h3>Activity</h3>
      <Row title="Activity" hint="Who or what read, saw, changed or was refused a sensitive item, and when; each reveal and copy of a secret. Exported as a spreadsheet.">
        <button className="button" onClick={() => (closeModal(), A.openLocked('activity'))}>
          <Icon name="history" size={14} /> Open the trail
        </button>
      </Row>
    </div>
  );
}
