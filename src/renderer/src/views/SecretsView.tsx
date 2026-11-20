// Secrets (Wave 4, 24 Oct 2026; module 22 of the life OS; 8.7 w4a restyle, 30 Oct 2026): the secrets sections of the
// one Locked place (10.0 v2locked). The lock itself (set up, unlock, lock now, the recovery password) lives on the
// Locked page; these panes show while open: passwords, passcodes, licence keys and ID numbers in a locked store inside
// the vault, shown masked, revealed for a moment or copied (the clipboard clears itself), never sent to any assistant
// or agent and never written in a note: a note links to one ("iPad passcode: [locked]"). Find in notes (the scanner:
// secrets already sitting in notes, moved into Secrets with a locked link left in each place, with Undo) and Activity
// (the audit trail, exported as CSV). Everything here goes through src/main/sensitive.ts; a value reaches the window
// only when the person reveals it.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ScanFindingView, ScanReport, SecretInput, SecretType, SecretView } from '../../../shared/secrets';
import { KIND_LABELS } from '../../../shared/secret-scan';
import { ACTION_WORDS, auditCsv, LEVELS, type AuditEntry, type Level } from '../../../shared/sensitivity';
import { plural } from '../../../shared/words';
import { confirm } from '../components/Dialogs';
import { LearnMore } from '../components/Settings';
import { fileIcon, Icon, type IconName } from '../components/Icon';
import { LevelMark, pickLevel } from '../components/LevelPicker';
import { openMenu, type MenuItem } from '../components/Menu';
import { errorMessage } from '../lib/errors';
import { whenAgo } from '../lib/projectLook';
import { resolveAny } from '../lib/resolve';
import * as A from '../state/actions';
import { usePrivacy } from '../state/privacy';
import { showError, toast, useApp } from '../state/store';
import { withStepUp } from '../lib/step-up';

const KIND_ICON: Record<SecretType, IconName> = { password: 'key', passcode: 'lock', card: 'tag', 'api-key': 'code', 'private-key': 'server', licence: 'star', 'id-number': 'person', bank: 'chart', other: 'key' };
const KIND_NAMES: Record<SecretType, string> = { ...KIND_LABELS, other: 'Other' };
const KINDS = Object.keys(KIND_NAMES) as SecretType[];

/** A strong password made here (letters, digits and a few symbols that every sign-in form takes). */
function makePassword(length = 20): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!#%+=?@';
  const bytes = crypto.getRandomValues(new Uint32Array(length));
  return [...bytes].map((b) => chars[b % chars.length]).join('');
}

function dateWords(ms: number): string {
  return new Date(ms).toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// ── Reveal and copy (values hide again; the clipboard clears itself) ─────────────────────────────────────────────────

function useReveal() {
  const [shown, setShown] = useState<Record<string, string>>({});
  const timers = useRef<Record<string, number>>({});
  useEffect(() => () => Object.values(timers.current).forEach((t) => window.clearTimeout(t)), []);
  const reveal = async (id: string) => {
    if (shown[id] !== undefined) {
      setShown(({ [id]: _gone, ...rest }) => rest);
      return;
    }
    try {
      const value = await withStepUp(() => window.nv.secrets.reveal(id));
      setShown((s) => ({ ...s, [id]: value }));
      window.clearTimeout(timers.current[id]);
      timers.current[id] = window.setTimeout(() => setShown(({ [id]: _gone, ...rest }) => rest), 20_000);
    } catch (err) {
      showError(err);
    }
  };
  return { shown, reveal };
}

async function copySecret(id: string) {
  try {
    const { seconds } = await withStepUp(() => window.nv.secrets.copy(id));
    toast(`Copied. It leaves the clipboard in ${plural(seconds, 'second')}.`);
  } catch (err) {
    showError(err);
  }
}

function secretMenu(e: React.MouseEvent<HTMLElement>, s: SecretView, canEdit: boolean, onChanged: () => void) {
  e.stopPropagation();
  const items: MenuItem[] = [
    {
      label: 'Copy a locked link for a note',
      icon: 'link',
      hint: 'Holds no secret',
      run: () => {
        void window.nv.secrets.copyLink(s.id).then(({ seconds }) => toast(`A locked link is on the clipboard: paste it into a note. It never holds the secret, and it leaves the clipboard in ${plural(seconds, 'second')}.`), showError);
      },
    },
    ...(s.from ? [{ label: 'Open the note it came from', icon: 'file', run: () => A.openPath(s.from!, { where: 'tab' }) } as MenuItem] : []),
    { separator: true },
    {
      label: 'Delete',
      icon: 'trash',
      danger: true,
      disabled: !canEdit,
      run: async () => {
        if (!(await confirm(`Delete “${s.name}”?`, { ok: 'Delete', danger: true, message: 'It goes to the Bin, still locked. Notes that link to it will show it as missing.' }))) return;
        try {
          await window.nv.secrets.remove(s.id);
          toast(`Deleted ${s.name}.`);
          onChanged();
        } catch (err) {
          showError(err);
        }
      },
    },
  ];
  openMenu(e.currentTarget, items);
}

// ── The list ─────────────────────────────────────────────────────────────────────────────────────────────────────────

function SecretRow({ s, revealed, onReveal, onOpen, onChanged }: { s: SecretView; revealed?: string; onReveal(): void; onOpen(): void; onChanged(): void }) {
  const canEdit = useApp((x) => x.canEdit);
  const sub = [s.where, s.username ? `signs in as ${s.username}` : ''].filter(Boolean).join(' · ') || KIND_NAMES[s.kind];
  return (
    <li className="srow3 sx-item-row" data-secret={s.id}>
      <span className="gtile xs slate" aria-hidden="true">
        <Icon name={KIND_ICON[s.kind]} size={13} />
      </span>
      <button type="button" className="sx-open" onClick={onOpen} aria-label={`Open ${s.name}`}>
        <span className="nm clip">{s.name}</span>
        <span className="ds clip">{sub}</span>
      </button>
      <span className="ctl">
        <span className={`masked${revealed !== undefined ? ' is-shown' : ''}`}>{revealed !== undefined ? revealed : s.masked}</span>
        <button className="mini" aria-pressed={revealed !== undefined} title={revealed !== undefined ? 'Hide' : 'Show for 20 seconds'} onClick={onReveal}>
          {revealed !== undefined ? 'Hide' : 'Show'}
        </button>
        <button className="mini" onClick={() => void copySecret(s.id)}>Copy</button>
        <button className="iconbtn" title="More" onClick={(e) => secretMenu(e, s, canEdit, onChanged)}><Icon name="more" size={16} /></button>
      </span>
    </li>
  );
}

function SecretsList({ onAdd, onOpen, onShowScan }: { onAdd(): void; onOpen(id: string): void; onShowScan(): void }) {
  const { secretsRevision } = usePrivacy();
  const canEdit = useApp((s) => s.canEdit);
  const [list, setList] = useState<SecretView[] | null>(null);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<SecretType | 'all'>('all');
  const { shown, reveal } = useReveal();
  const load = useCallback(() => void window.nv.secrets.list().then(setList, showError), []);
  useEffect(load, [load, secretsRevision]);
  const kinds = useMemo(() => [...new Set((list ?? []).map((s) => s.kind))], [list]);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (list ?? []).filter((s) => (kind === 'all' || s.kind === kind) && (!q || [s.name, s.username, s.where, s.notes, KIND_NAMES[s.kind]].some((w) => w?.toLowerCase().includes(q))));
  }, [list, query, kind]);
  if (!list) return <div className="view-loading" />;
  return (
    <div className="sx-part">
      <div className="sbox sx-find">
        <Icon name="search" size={14} />
        <input placeholder="Find a secret…" aria-label="Find a secret" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      {kinds.length > 1 && (
        <div className="chips" role="group" aria-label="Kinds" style={{ marginTop: 10 }}>
          <button className={`chip${kind === 'all' ? ' on' : ''}`} onClick={() => setKind('all')}>
            All <span className="n">{list.length}</span>
          </button>
          {kinds.map((k) => (
            <button key={k} className={`chip${kind === k ? ' on' : ''}`} onClick={() => setKind(k)}>
              {KIND_NAMES[k]} <span className="n">{list.filter((s) => s.kind === k).length}</span>
            </button>
          ))}
        </div>
      )}
      {list.length === 0 ? (
        <div className="nv-empty">
          <div className="nv-empty-tile" aria-hidden="true"><Icon name="key" size={40} /></div>
          <div className="nv-empty-title">No secrets yet</div>
          <p className="nv-empty-line">Add one, or let Ironleaf find the passwords and codes already sitting in your notes.</p>
          <div className="nv-empty-actions">
            <button className="btn pri" disabled={!canEdit} onClick={onAdd}>Add a secret</button>
            <button className="btn" onClick={onShowScan}>Find secrets in notes</button>
          </div>
        </div>
      ) : rows.length === 0 ? (
        <p className="pv-none">Nothing matches.</p>
      ) : (
        <>
          <div className="glabel" style={{ margin: '10px 0 2px' }}>{list.length} kept</div>
          <ul className="sx-list">
            {rows.map((s) => (
              <SecretRow key={s.id} s={s} revealed={shown[s.id]} onReveal={() => void reveal(s.id)} onOpen={() => onOpen(s.id)} onChanged={load} />
            ))}
          </ul>
        </>
      )}
      <p style={{ fontSize: 13, color: 'var(--text-faint)', marginTop: 12 }}>Shown values hide again after 20 seconds. Each reveal and copy is logged.</p>
    </div>
  );
}

// ── Add one ──────────────────────────────────────────────────────────────────────────────────────────────────────────

function AddSecret({ onDone }: { onDone(saved: boolean): void }) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<SecretType>('password');
  const [value, setValue] = useState('');
  const [showValue, setShowValue] = useState(false);
  const [username, setUsername] = useState('');
  const [where, setWhere] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState('');
  const save = async () => {
    setBusy(true);
    setSaid('');
    try {
      const v = await window.nv.secrets.add({ name, kind, value, username, where, notes } satisfies SecretInput);
      toast(`${v.name} is in Secrets.`);
      onDone(true);
    } catch (err) {
      setSaid(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="sx-part" style={{ maxWidth: 680 }}>
      <h2 className="w4a-title" style={{ fontSize: 20 }}>Add its login</h2>
      <p className="vsub" style={{ marginTop: 4 }}>Kept locked on this PC. Link it from a note instead of writing it there.</p>
      <div className="field"><label>Name</label><input value={name} placeholder="What it is for" onChange={(e) => setName(e.target.value)} autoFocus /></div>
      <div className="field">
        <label>Kind</label>
        <select className="setting-input" style={{ width: '100%' }} value={kind} onChange={(e) => setKind(e.target.value as SecretType)}>
          {KINDS.map((k) => (
            <option key={k} value={k}>{KIND_NAMES[k]}</option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>{kind === 'passcode' ? 'Passcode' : kind === 'card' ? 'Number' : kind === 'password' ? 'Password' : 'The secret'}</label>
        <div className="valrow">
          <input type={showValue ? 'text' : 'password'} value={value} autoComplete="off" spellCheck={false} onChange={(e) => setValue(e.target.value)} />
          <button type="button" className="mini" onClick={() => setShowValue((v) => !v)}>{showValue ? 'Hide' : 'Show'}</button>
          {kind === 'password' && (
            <button type="button" className="mini" onClick={() => (setValue(makePassword()), setShowValue(true))}>Make one</button>
          )}
        </div>
      </div>
      <div className="field"><label>Signs in as</label><input placeholder="Who it signs in as" value={username} onChange={(e) => setUsername(e.target.value)} /></div>
      <div className="field"><label>Website, device or place</label><input placeholder="A website, device or place" value={where} onChange={(e) => setWhere(e.target.value)} /></div>
      <div className="field"><label>Notes</label><textarea rows={2} placeholder="Anything that helps (never the secret itself)" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
      {said && <p className="pv-said">{said}</p>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 22 }}>
        <button className="btn pri" style={{ height: 38 }} disabled={busy || !name.trim() || !value} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save to Secrets'}
        </button>
        <button className="btn quiet" style={{ height: 38 }} onClick={() => onDone(false)}>Cancel</button>
      </div>
    </div>
  );
}

// ── One secret's page ────────────────────────────────────────────────────────────────────────────────────────────────

function SecretDetail({ id, onBack, onChanged }: { id: string; onBack(): void; onChanged(): void }) {
  const canEdit = useApp((s) => s.canEdit);
  const [s, setS] = useState<SecretView | null>(null);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<SecretType>('password');
  const [username, setUsername] = useState('');
  const [where, setWhere] = useState('');
  const [notes, setNotes] = useState('');
  const [value, setValue] = useState('');
  const [changing, setChanging] = useState(false);
  const [showValue, setShowValue] = useState(false);
  const [used, setUsed] = useState<{ path: string; title: string }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState('');
  const { shown, reveal } = useReveal();
  const load = useCallback(() => {
    void window.nv.secrets.list().then((all) => {
      const v = all.find((x) => x.id === id) ?? null;
      setS(v);
      if (v) {
        setName(v.name);
        setKind(v.kind);
        setUsername(v.username ?? '');
        setWhere(v.where ?? '');
        setNotes(v.notes ?? '');
      }
    }, showError);
    void window.nv.secrets.usedIn(id).then(setUsed, () => setUsed([]));
  }, [id]);
  useEffect(load, [load]);
  if (!s) return <div className="sx-part"><div className="view-loading" /></div>;
  const revealed = shown[s.id];
  const dirty = name.trim() !== s.name || kind !== s.kind || username !== (s.username ?? '') || where !== (s.where ?? '') || notes !== (s.notes ?? '') || (changing && !!value);
  const save = async () => {
    setBusy(true);
    setSaid('');
    try {
      const patch: SecretInput = { name: name.trim(), kind, username, where, notes, ...(changing ? { value } : {}) };
      await window.nv.secrets.update(s.id, patch);
      toast(`Saved ${name.trim()}.`);
      setChanging(false);
      setValue('');
      onChanged();
      load();
    } catch (err) {
      setSaid(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!(await confirm(`Delete “${s.name}”?`, { ok: 'Delete', danger: true, message: 'It goes to the Bin, still locked. Notes that link to it will show it as missing.' }))) return;
    try {
      await window.nv.secrets.remove(s.id);
      toast(`Deleted ${s.name}.`);
      onChanged();
      onBack();
    } catch (err) {
      showError(err);
    }
  };
  return (
    <div className="sx-part" style={{ maxWidth: 680 }}>
      <button className="btn quiet" onClick={onBack}><Icon name="back" size={14} /> Secrets</button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 8 }}>
        <span className="gtile slate" style={{ fontSize: 18 }} aria-hidden="true">
          <Icon name={KIND_ICON[s.kind]} size={18} />
        </span>
        <input className="w4a-htitle" value={name} aria-label="Its name" disabled={!canEdit} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field">
        <label>Kind</label>
        <select className="setting-input" style={{ width: 240 }} value={kind} disabled={!canEdit} onChange={(e) => setKind(e.target.value as SecretType)}>
          {KINDS.map((k) => (
            <option key={k} value={k}>{KIND_NAMES[k]}</option>
          ))}
        </select>
      </div>
      <div className="field"><label>Website, device or place</label><div className="box"><input className="box-input" value={where} placeholder="A website, device or place" disabled={!canEdit} onChange={(e) => setWhere(e.target.value)} /></div></div>
      <div className="field">
        <label>Signs in as</label>
        <div className="box"><input className="box-input" value={username} placeholder="Who it signs in as" disabled={!canEdit} onChange={(e) => setUsername(e.target.value)} />{username && <button className="mini" style={{ marginLeft: 'auto' }} onClick={() => void navigator.clipboard?.writeText(username).then(() => toast('Copied.'), showError)}>Copy</button>}</div>
      </div>
      <div className="field">
        <label>{kind === 'passcode' ? 'Passcode' : kind === 'card' ? 'Number' : kind === 'password' ? 'Password' : 'The secret'}</label>
        <div className="box">
          {changing ? (
            <>
              <input className="box-input" type={showValue ? 'text' : 'password'} value={value} autoComplete="off" spellCheck={false} placeholder="The new value" onChange={(e) => setValue(e.target.value)} autoFocus />
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                <button className="mini" onClick={() => setShowValue((v) => !v)}>{showValue ? 'Hide' : 'Show'}</button>
                {kind === 'password' && <button className="mini" onClick={() => (setValue(makePassword()), setShowValue(true))}>Make one</button>}
                <button className="mini" onClick={() => (setChanging(false), setValue(''))}>Keep the old one</button>
              </span>
            </>
          ) : (
            <>
              <span className={revealed !== undefined ? 'sx-shown' : 'sx-masked'}>{revealed !== undefined ? revealed : s.masked}</span>
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                <button className="mini" onClick={() => void reveal(s.id)}>{revealed !== undefined ? 'Hide' : 'Show'}</button>
                <button className="mini" onClick={() => void copySecret(s.id)}>Copy</button>
                <button className="mini" disabled={!canEdit} onClick={() => (setChanging(true), setValue(''), setShowValue(true))}>Change</button>
              </span>
            </>
          )}
        </div>
      </div>
      <div className="field"><label>Notes</label><div className="box"><textarea className="box-input" rows={2} value={notes} placeholder="Anything that helps (never the secret itself)" disabled={!canEdit} onChange={(e) => setNotes(e.target.value)} /></div></div>
      <div className="glabel" style={{ margin: '22px 0 2px' }}>Linked from · {used?.length ?? 0} {used?.length === 1 ? 'note' : 'notes'}</div>
      {used === null ? (
        <p className="sx-faint">Looking…</p>
      ) : used.length ? (
        used.map((u) => (
          <button key={u.path} className="linkrow" onClick={() => A.openPath(u.path, { where: 'tab' })}>
            <span className="gtile xs blue" aria-hidden="true"><Icon name={fileIcon(u.path)} size={14} /></span>
            <span className="clip">{u.title}</span>
            <span style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--text-faint)' }}>{u.path.split('/').slice(0, -1).pop() ?? ''}</span>
          </button>
        ))
      ) : (
        <p className="sx-faint">No note links to it yet. Use the More menu, Copy a locked link, on the list.</p>
      )}
      {said && <p className="pv-said">{said}</p>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 26 }}>
        <button className="btn pri" style={{ height: 38 }} disabled={busy || !dirty || !name.trim() || (changing && !value)} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save changes'}
        </button>
        <button className="danger" disabled={!canEdit} onClick={() => void remove()}>Delete this login</button>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-faint)' }}>
          Added {whenAgo(s.created)}{s.modified !== s.created ? ` · changed ${whenAgo(s.modified)}` : ''}
        </span>
      </div>
    </div>
  );
}

type Sub = { view: 'list' } | { view: 'add' } | { view: 'detail'; id: string };

/** The secrets section: the list, adding one, one secret's page. The Locked page owns the lock and the tabs. */
export function SecretsPane({ onChanged, onShowScan, onAddState }: { onChanged(): void; onShowScan(): void; onAddState(open: boolean, add: () => void): void }) {
  const [sub, setSub] = useState<Sub>({ view: 'list' });
  useEffect(() => {
    onAddState(sub.view === 'list', () => setSub({ view: 'add' }));
  }, [sub.view, onAddState]);
  if (sub.view === 'add') return <AddSecret onDone={(saved) => (saved && onChanged(), setSub({ view: 'list' }))} />;
  if (sub.view === 'detail') return <SecretDetail id={sub.id} onBack={() => setSub({ view: 'list' })} onChanged={onChanged} />;
  return <SecretsList onAdd={() => setSub({ view: 'add' })} onOpen={(id) => setSub({ view: 'detail', id })} onShowScan={onShowScan} />;
}

// ── The scanner ──────────────────────────────────────────────────────────────────────────────────────────────────────

function FindingRow({ f, name, onName, onMove, onIgnore, busy }: { f: ScanFindingView; name: string; onName(v: string): void; onMove(): void; onIgnore(): void; busy: boolean }) {
  const canEdit = useApp((s) => s.canEdit);
  return (
    <li className="sx-find">
      <span className={`sx-kind k-${f.kind}`} aria-hidden="true">
        <Icon name={KIND_ICON[f.kind]} size={14} />
      </span>
      <span className="sx-find-words">
        <input className="sx-find-name" value={name} aria-label="Its name in Secrets" onChange={(e) => onName(e.target.value)} />
        <span className="sx-find-context">
          <span className="sx-line">Line {f.line}</span> {f.context}
        </span>
      </span>
      <span className={`sx-sure${f.confidence === 'high' ? ' high' : ''}`}>{f.confidence === 'high' ? KIND_LABELS[f.kind] : `Likely a ${KIND_LABELS[f.kind].toLowerCase()}`}</span>
      <span className="sx-find-actions">
        <button className="button small sx-quiet" disabled={!canEdit || busy} onClick={onIgnore} title="Leave it, and don’t show it again">
          Not a secret
        </button>
        <button className="button small" disabled={!canEdit || busy} onClick={onMove}>
          <Icon name="lock" size={12} /> Move into Secrets
        </button>
      </span>
    </li>
  );
}

export function ScanPane() {
  const canEdit = useApp((s) => s.canEdit);
  const [report, setReport] = useState<ScanReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [names, setNames] = useState<Record<string, string>>({});
  const scan = async () => {
    setBusy(true);
    try {
      const r = await window.nv.scan.run();
      setReport(r);
      setNames(Object.fromEntries(r.notes.flatMap((n) => n.findings.map((f) => [f.fp, f.name]))));
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void scan();
  }, []);
  const total = report?.notes.reduce((n, x) => n + x.findings.length, 0) ?? 0;
  const move = async (items: { path: string; fp: string }[], words: string) => {
    setBusy(true);
    try {
      const r = await window.nv.scan.move(items.map((i) => ({ ...i, name: names[i.fp] })));
      await scan();
      const undo = r.undoId;
      toast(`${words.replace('{n}', String(r.moved))}${r.skipped.length ? ` ${r.skipped.join(' ')}` : ''}`, undo ? { label: 'Undo', run: () => void window.nv.scan.undo(undo).then((w) => (toast(w), void scan()), showError) } : undefined);
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };
  const ignore = async (fp: string) => {
    try {
      await window.nv.scan.ignore(fp, true);
      setReport((r) => (r ? { ...r, ignored: r.ignored + 1, notes: r.notes.map((n) => ({ ...n, findings: n.findings.filter((f) => f.fp !== fp) })).filter((n) => n.findings.length) } : r));
      toast('Left as it is. It won’t be shown again.', { label: 'Undo', run: () => void window.nv.scan.ignore(fp, false).then(() => void scan()) });
    } catch (err) {
      showError(err);
    }
  };
  if (!report) return <div className="sx-part"><div className="sx-scanning"><span className="sx-spinner" /> Looking through your notes…</div></div>;
  return (
    <div className="sx-part">
      <div className="sx-scan-head">
        <div>
          <strong>{total ? `${total} ${total === 1 ? 'secret' : 'secrets'} in ${report.notes.length} ${report.notes.length === 1 ? 'note' : 'notes'}` : 'No secrets sitting in your notes'}</strong>
          <span className="sx-faint">
            Looked through {report.scanned} notes {whenAgo(report.at)}
            {report.ignored ? ` · ${report.ignored} you said aren’t secrets left out` : ''}.{' '}
            <LearnMore>Values are shown masked here; each one moves into Secrets and a locked link takes its place in the note.</LearnMore>
          </span>
        </div>
        <div className="sx-scan-actions">
          <button className="button" disabled={busy} onClick={() => void scan()}>
            <Icon name="refresh" size={14} /> {busy ? 'Looking…' : 'Look again'}
          </button>
          {total > 0 && (
            <button className="button primary" disabled={!canEdit || busy} onClick={() => void move(report.notes.flatMap((n) => n.findings.map((f) => ({ path: n.path, fp: f.fp }))), 'Moved {n} into Secrets. Each note now holds a locked link instead.')}>
              Move all {total} into Secrets
            </button>
          )}
        </div>
      </div>
      {report.notes.map((n) => (
        <section key={n.path} className="sx-note">
          <header className="sx-note-head">
            <button className="sx-note-title" onClick={() => A.openPath(n.path, { where: 'tab' })}>
              <Icon name="file" size={13} /> {n.title}
            </button>
            <LevelMark level={n.level} quiet />
            <span className="sx-faint">{n.findings.length === 1 ? '1 secret' : `${n.findings.length} secrets`}</span>
            {n.findings.length > 1 && (
              <button className="button small" disabled={!canEdit || busy} onClick={() => void move(n.findings.map((f) => ({ path: n.path, fp: f.fp })), `Moved {n} from ${n.title} into Secrets.`)}>
                Move these {n.findings.length}
              </button>
            )}
          </header>
          <ul className="sx-finds">
            {n.findings.map((f) => (
              <FindingRow key={f.fp} f={f} busy={busy} name={names[f.fp] ?? f.name} onName={(v) => setNames((x) => ({ ...x, [f.fp]: v }))} onMove={() => void move([{ path: n.path, fp: f.fp }], `Moved “${names[f.fp] ?? f.name}” into Secrets.`)} onIgnore={() => void ignore(f.fp)} />
            ))}
          </ul>
        </section>
      ))}
      {report.files.length > 0 && (
        <section className="sx-note sx-files">
          <header className="sx-note-head">
            <strong>Files that may hold passwords</strong>
            <span className="sx-faint">A file can’t be changed here: give it a level so agents can’t read it, or keep what it holds in Secrets and delete it.</span>
          </header>
          <ul className="sx-finds">
            {report.files.map((f) => (
              <li key={f.path} className="sx-find">
                <span className="sx-kind" aria-hidden="true">
                  <Icon name="file" size={14} />
                </span>
                <span className="sx-find-words">
                  <button className="sx-note-title" onClick={() => A.openPath(f.path, { where: 'tab' })}>
                    {f.name}
                  </button>
                  <span className="sx-find-context">{f.path}</span>
                </span>
                <LevelMark level={f.level} />
                <span className="sx-find-actions">
                  <button className="button small" disabled={!canEdit} onClick={(e) => pickLevel(e.currentTarget, f.path)}>
                    Set its level
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {total === 0 && report.files.length === 0 && (
        <div className="pv-empty sx-empty">
          <Icon name="check" size={22} />
          <p>Nothing that looks like a password, passcode, card number or key is sitting in your notes.</p>
        </div>
      )}
    </div>
  );
}

// ── Activity: the audit trail ────────────────────────────────────────────────────────────────────────────────────────

/** A trail row's note or file (9.2 uplift F111): open by resolved vault path, never by guessing from the item's
 *  words. Secrets ("Secret: …") and joined lists resolve to nothing and stay unopenable. */
function auditTarget(item: string): string | null {
  if (item.startsWith('Secret: ')) return null;
  return resolveAny(item);
}

export function ActivityPane() {
  const { revision } = usePrivacy();
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [who, setWho] = useState('all');
  const [level, setLevel] = useState<Level | 'all'>('all');
  const [query, setQuery] = useState('');
  const [months, setMonths] = useState(3);
  useEffect(() => {
    void window.nv.audit.list(months).then(setEntries, showError);
  }, [months, revision]);
  const people = useMemo(() => [...new Set((entries ?? []).map((e) => e.whoName))].sort((a, b) => (a === 'You' ? -1 : b === 'You' ? 1 : a.localeCompare(b))), [entries]);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (entries ?? []).filter((e) => (who === 'all' || e.whoName === who) && (level === 'all' || e.level === level) && (!q || `${e.item} ${e.detail ?? ''} ${ACTION_WORDS[e.action]}`.toLowerCase().includes(q)));
  }, [entries, who, level, query]);
  const exportIt = async () => {
    try {
      const where = await window.nv.exports.csv('Ironleaf audit trail', `﻿${auditCsv(rows)}`);
      if (!where) return;
      await window.nv.audit.exported(where);
      // Entries, not lines (3 Nov 2026, fourth-round G5): the file is a header line plus one line per entry, so "N lines" understated it by one and read "1 lines" with one.
      toast(`Saved ${plural(rows.length, 'entry', 'entries')} to ${where.split(/[\\/]/).pop()}.`, { label: 'Show', run: () => void window.nv.exports.reveal(where) });
    } catch (err) {
      showError(err);
    }
  };
  if (!entries) return <div className="view-loading" />;
  return (
    <div className="sx-part">
      <div className="sx-tools sx-audit-tools">
        <input className="pv-search sx-search" placeholder="Search the trail" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select className="sx-select" value={who} onChange={(e) => setWho(e.target.value)} aria-label="Who">
          <option value="all">Everyone</option>
          {people.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select className="sx-select" value={level} onChange={(e) => setLevel(e.target.value as Level | 'all')} aria-label="Level">
          <option value="all">Every level</option>
          {LEVELS.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
        <select className="sx-select" value={months} onChange={(e) => setMonths(Number(e.target.value))} aria-label="How far back">
          <option value={1}>This month</option>
          <option value={3}>Last 3 months</option>
          <option value={12}>Last 12 months</option>
        </select>
        <button className="button" disabled={!rows.length} onClick={() => void exportIt()}>
          <Icon name="download" size={14} /> Export
        </button>
      </div>
      {rows.length === 0 ? (
        <div className="pv-empty sx-empty">
          <Icon name="history" size={22} />
          <p>{entries.length ? 'Nothing in the trail matches.' : 'Nothing yet. Each time an assistant or agent reads, sees or is refused something sensitive, and each time you reveal or copy a secret, it shows here.'}</p>
        </div>
      ) : (
        <div className="sx-audit" role="table" aria-label="Audit trail">
          <div className="sx-audit-row head" role="row">
            <span role="columnheader">When</span>
            <span role="columnheader">Who</span>
            <span role="columnheader">What</span>
            <span role="columnheader">Item</span>
          </div>
          {rows.slice(0, 500).map((e, i) => (
            <div key={`${e.at}-${i}`} className={`sx-audit-row a-${e.action}`} role="row">
              <span className="sx-when" role="cell" title={new Date(e.at).toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' })}>
                {dateWords(e.at)}
              </span>
              <span className="sx-who" role="cell">
                {e.whoName}
                {e.pc && <em>{e.pc}</em>}
              </span>
              <span className="sx-what" role="cell">
                {ACTION_WORDS[e.action] ?? e.action}
              </span>
              <span className="sx-item" role="cell">
                {e.level && <LevelMark level={e.level} quiet />}
                <button className="sx-item-name" disabled={!auditTarget(e.item)} onClick={() => { const t = auditTarget(e.item); if (t) A.openPath(t, { where: 'tab' }); }}>
                  {e.item}
                </button>
                {e.detail && <span className="sx-faint">{e.detail}</span>}
              </span>
            </div>
          ))}
          {rows.length > 500 && <p className="sx-faint">The newest 500 are shown; Export has all {rows.length}.</p>}
        </div>
      )}
    </div>
  );
}
