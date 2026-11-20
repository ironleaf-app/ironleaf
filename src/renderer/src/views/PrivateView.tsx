// Private notes (16 Oct 2026): the notes section of the one Locked place (10.0 v2locked). The lock itself (set up,
// unlock, lock now, the recovery password) lives on the Locked page; this is the list while open: notes in tabs
// like any note, searched here only, never indexed.

import { useEffect, useMemo, useState } from 'react';
import type { PrivateEntry } from '../../../shared/types';
import { prompt } from '../components/Dialogs';
import { Icon } from '../components/Icon';
import { openMenu } from '../components/Menu';
import { errorMessage } from '../lib/errors';
import { whenAgo } from '../lib/projectLook';
import * as A from '../state/actions';
import { reloadPrivateList } from '../state/private';
import { withStepUp } from '../lib/step-up';
import { showError, toast, useApp } from '../state/store';

const MIN = 10;

export function ChangePassword({ onDone }: { onDone(): void }) {
  const [first, setFirst] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState('');
  return (
    <form
      className="pv-change"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setSaid('');
        try {
          await withStepUp(() => window.nv.private.changePassword(first));
          toast('The new recovery password works from now on; the old one doesn’t.');
          onDone();
        } catch (err) {
          setSaid(errorMessage(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <strong>A new recovery password</strong>
      <input type="password" autoComplete="new-password" placeholder={`At least ${MIN} characters`} value={first} onChange={(e) => setFirst(e.target.value)} autoFocus />
      <input type="password" autoComplete="new-password" placeholder="Type it again" value={again} onChange={(e) => setAgain(e.target.value)} />
      {said && <p className="pv-said">{said}</p>}
      <span className="pv-change-actions">
        <button type="button" className="button" onClick={onDone}>
          Cancel
        </button>
        <button type="submit" className="button primary" disabled={busy || first.length < MIN || first !== again}>
          {busy ? 'Saving…' : 'Change it'}
        </button>
      </span>
    </form>
  );
}

/** "Private notes/Health/Blood tests.md" → its folder inside ("Health") and its name ("Blood tests"). */
function placeOf(path: string): { folder: string; name: string } {
  const inside = path.replace(/^Private notes\//i, '');
  const at = inside.lastIndexOf('/');
  return { folder: at >= 0 ? inside.slice(0, at) : '', name: (at >= 0 ? inside.slice(at + 1) : inside).replace(/\.md$/i, '') };
}

/** A steady tint per folder, so rows tell apart at a glance (display only; every private note is only yours). */
function folderTint(folder: string): string {
  const tints = ['slate', 'blue', 'green', 'amber', 'red'];
  let h = 0;
  for (const c of folder.toLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return tints[h % tints.length];
}

export function PrivateNotesPane({ notes }: { notes: PrivateEntry[] }) {
  const canEdit = useApp((s) => s.canEdit);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<{ path: string; line: string }[] | null>(null);
  useEffect(() => {
    if (!query.trim()) {
      setHits(null);
      return;
    }
    const t = setTimeout(() => void window.nv.private.search(query).then(setHits, showError), 180);
    return () => clearTimeout(t);
  }, [query]);
  const shown = useMemo(() => (hits ? notes.filter((n) => hits.some((h) => h.path === n.path)).sort((a, b) => b.modified - a.modified) : notes), [notes, hits]);
  const groups = useMemo(() => {
    const rows = [...shown].sort((a, b) => b.modified - a.modified);
    const map = new Map<string, PrivateEntry[]>();
    for (const n of rows) {
      const { folder } = placeOf(n.path);
      if (!map.has(folder)) map.set(folder, []);
      map.get(folder)!.push(n);
    }
    return [...map.entries()].sort((a, b) => (a[0] === '' ? -1 : b[0] === '' ? 1 : a[0].localeCompare(b[0])));
  }, [shown]);
  const create = async () => {
    const name = await prompt('New private note', { ok: 'Make it', placeholder: 'Its name' });
    if (!name?.trim()) return;
    try {
      const path = await window.nv.private.create('', name.trim());
      await reloadPrivateList();
      A.openPath(path, { where: 'tab' });
    } catch (err) {
      showError(err);
    }
  };
  const rowMenu = (e: React.MouseEvent<HTMLElement>, n: PrivateEntry) => {
    e.preventDefault();
    openMenu(e.currentTarget, [
      { label: 'Open in a new tab', icon: 'newTab', run: () => A.openPath(n.path, { where: 'tab' }) },
      { label: 'Rename', icon: 'edit', disabled: !canEdit, run: () => void A.askRename(n.path) },
      { separator: true },
      { label: 'Delete', icon: 'trash', danger: true, disabled: !canEdit, run: () => void A.trashPath(n.path) },
    ]);
  };
  return (
    <div className="sx-part">
      {notes.length > 0 && (
        <div className="sbox sx-find">
          <Icon name="search" size={14} />
          <input placeholder="Search your private notes" aria-label="Search your private notes" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      )}
      {notes.length === 0 ? (
        <div className="nv-empty">
          <div className="nv-empty-tile" aria-hidden="true"><Icon name="lock" size={40} /></div>
          <div className="nv-empty-title">No private notes yet</div>
          <p className="nv-empty-line">They open in tabs like any note, and save as you type.</p>
          <div className="nv-empty-actions">
            <button className="btn pri" disabled={!canEdit} onClick={() => void create()}>Write the first one</button>
          </div>
        </div>
      ) : groups.length === 0 ? (
        <p className="pv-none">Nothing matches.</p>
      ) : (
        <>
          <div className="glabel" style={{ margin: '10px 0 2px' }}>{hits ? `${shown.length} of ${notes.length} ` : ''}{shown.length === 1 ? 'note' : 'notes'}</div>
          {groups.map(([folder, rows]) => (
            <section key={folder || '-'}>
              {folder && <div className="glabel" style={{ margin: '10px 0 2px' }}>{folder}</div>}
              <ul className="pv-list-87">
                {rows.map((n) => {
                  const hit = hits?.find((h) => h.path === n.path);
                  const { folder: f, name } = placeOf(n.path);
                  return (
                    <li key={n.path} className="prow2 pv-row-87">
                      <span className={`gtile xs ${folderTint(f)}`} aria-hidden="true"><Icon name="file" size={12} /></span>
                      <button className="pv-open" onClick={(e) => A.openPath(n.path, { where: e.ctrlKey || e.metaKey ? 'tab' : 'current' })} onContextMenu={(e) => rowMenu(e, n)}>
                        <span className="t clip">{name}</span>
                        <span className="p clip">{hit?.line || `${f || 'Private notes'} · changed ${whenAgo(n.modified)}`}</span>
                      </button>
                      <span className="tag red" style={{ marginLeft: 'auto' }}>Only you</span>
                      <button className="iconbtn" title="More" onClick={(e) => rowMenu(e, n)}><Icon name="more" size={16} /></button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </>
      )}
      {notes.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <button className="btn pri" disabled={!canEdit} onClick={() => void create()}>+ New private note</button>
        </div>
      )}
    </div>
  );
}
