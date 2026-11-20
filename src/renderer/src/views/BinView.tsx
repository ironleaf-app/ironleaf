// Recently deleted, in Ironleaf (8.0 U13, 28 Oct 2026). The same list the former host app's Recently deleted shows,
// drawn here: the vault's own Bin (notes, files and folders, whoever took them out: the person, the former host app, a
// chat bot, an agent), what the former host app deleted (agents, skills, automations, a Health entry) and the deleted
// conversations, newest first, with Restore and Delete now for each and Empty for all. Delete now and Empty ask first,
// in the page (never a browser dialog); nothing else removes anything before its 30 days are up.

import { useCallback, useEffect, useState } from 'react';
import { plural } from '../../../shared/words';
import { EmptyState } from '../components/EmptyState';
import { Icon } from '../components/Icon';
import { openMenu } from '../components/Menu';
import { errorMessage } from '../lib/errors';
import { headerOverflowHidden, overflowMenuItems } from '../lib/headerOverflow';
import * as A from '../state/actions';
import type * as W from '../state/workspace';
import { showError, toast } from '../state/store';
import { ViewHeader } from './ViewHeader';

interface Gone {
  type: 'conversation' | 'bin' | 'vault';
  id: string;
  app?: 'spark' | 'vault';
  kind: string;
  kindWords?: string;
  title: string;
  detail?: string;
  cwd?: string;
  deletedAt: number;
  daysLeft: number;
}
type Group = 'all' | 'vault' | 'conversations' | 'automations' | 'agents';
const GROUPS: readonly (readonly [Group, string])[] = [
  ['all', 'All'],
  ['vault', 'Ironleaf'],
  ['conversations', 'Conversations'],
  ['automations', 'Automations'],
  ['agents', 'Agents and skills'],
];
const groupOf = (g: Gone): Group =>
  g.type === 'conversation' ? 'conversations' : g.type === 'vault' || g.app === 'vault' || ['note', 'file', 'folder', 'health', 'record'].includes(g.kind) ? 'vault' : ['automation', 'routine'].includes(g.kind) ? 'automations' : 'agents';
const BIN_EMPTY: Record<Group, string> = { all: 'Nothing here.', vault: 'No notes here.', conversations: 'No conversations here.', automations: 'No automations here.', agents: 'No agents or skills here.' };
const TILES: Record<string, [string, string]> = { note: ['slate', '◧'], file: ['blue', '◧'], folder: ['slate', '▤'], conversation: ['green', '✎'], automation: ['amber', '⚡'], routine: ['amber', '⚡'], agent: ['blue', '◧'], skill: ['slate', '◧'], health: ['red', '♥'], record: ['green', '▦'] };
const tileOf = (kind: string): [string, string] => TILES[kind] ?? ['slate', '◧'];
const when = (at: number) => {
  const m = Math.round((Date.now() - at) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.round(m / 60)} h ago`;
  const d = Math.round(m / 1440);
  return d === 1 ? 'yesterday' : d <= 30 ? `${d} days ago` : new Date(at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
};

export function BinView({ tab }: { tab: W.TabState }) {
  const [items, setItems] = useState<Gone[] | null>(null);
  const [error, setError] = useState('');
  const [group, setGroup] = useState<Group>('all');
  const [busy, setBusy] = useState('');
  const [asking, setAsking] = useState<string | null>(null);
  const [restored, setRestored] = useState<Record<string, true>>({});

  const load = useCallback(async () => {
    try {
      const v = (await window.nv.bin.call({ action: 'list' })) as { items?: Omit<Gone, 'type'>[]; others?: Gone[] };
      const conversations = (v.items ?? []).map((c) => ({ ...c, type: 'conversation' as const, kind: 'conversation', kindWords: 'Conversation' }));
      setItems([...conversations, ...(v.others ?? [])].sort((a, b) => b.deletedAt - a.deletedAt));
      setError('');
    } catch (e) {
      setError(errorMessage(e));
      setItems([]);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const act = async (g: Gone, action: 'restore' | 'purge') => {
    setBusy(g.id);
    try {
      await window.nv.bin.call(g.type === 'conversation' ? { action, sessionId: g.id } : { action, id: g.id, type: g.type });
      if (action === 'restore') {
        setRestored((r) => ({ ...r, [g.id]: true }));
        toast(`“${g.title || g.kindWords}” is back.`);
      } else {
        setAsking(null);
        setItems((list) => (list ?? []).filter((x) => x.id !== g.id));
        toast(`“${g.title || g.kindWords}” is gone for good.`);
      }
    } catch (e) {
      showError(e);
    } finally {
      setBusy('');
    }
  };
  const empty = async () => {
    setBusy('empty');
    try {
      await window.nv.bin.call({ action: 'empty' });
      setAsking(null);
      setItems([]);
      toast('Recently deleted is empty now. Everything in it is gone for good.');
    } catch (e) {
      showError(e);
    } finally {
      setBusy('');
    }
  };

  const all = items ?? [];
  const present = GROUPS.filter(([id]) => id === 'all' || all.some((g) => groupOf(g) === id));
  const shown = all.filter((g) => group === 'all' || groupOf(g) === group);
  return (
    <>
      <ViewHeader
        tab={tab}
        crumb={<><button className="crumb-folder" onClick={() => A.openSettings('backups')}>Settings</button><span> / </span><b>Bin</b></>}
      >
        {/* The header contract (Round 2, 4 Nov 2026, the reviewer: nothing may ever overlap the centred
            search): Empty all yields into the ⋯ beside it when measured within 12px of the bar. */}
        {all.length > 0 && (
          <button type="button" className="btn" data-overflow="empty-all" data-overflow-order={1} disabled={!!busy} onClick={() => setAsking('empty')}>
            Remove all
          </button>
        )}
        <button type="button" className="navbtn topbar-tight-only" data-overflow-fallback="" aria-label="More for the Bin" title="More" onClick={(e) => openMenu(e.currentTarget, overflowMenuItems(headerOverflowHidden(tab.id), {
          'empty-all': () => ({ label: 'Remove all', icon: 'trash', disabled: !!busy, run: () => setAsking('empty') }),
        }))}>
          <Icon name="more" size={16} />
        </button>
      </ViewHeader>
      <div className="nv-page-scroll bin-page">
        <div className="nv-page">
          <h1 className="w4a-title">Bin</h1>
          <p className="vsub" style={{ margin: '4px 0 8px' }}>One bin for your notes. What you or another app delete stays here for 30 days, with Restore. After that it’s gone for good.</p>
        {asking === 'empty' && (
          <div className="bin-ask" role="alertdialog" aria-label="Remove everything from the Bin?">
            {/* The one item reads as itself (3 Nov 2026, fourth-round G6): "Remove the 1 item", never "Remove all 1". */}
            <span>Remove {all.length === 1 ? `the ${plural(all.length, 'item')}` : `all ${plural(all.length, 'item')}`} for good? This can’t be undone.</span>
            <button type="button" className="button" autoFocus onClick={() => setAsking(null)}>
              Cancel
            </button>
            <button type="button" className="button danger" disabled={busy === 'empty'} onClick={() => void empty()}>
              {busy === 'empty' ? 'Removing…' : 'Remove all'}
            </button>
          </div>
        )}
        {present.length > 2 && (
          <div className="chips" role="group" aria-label="What to show" style={{ marginBottom: 6 }}>
            {present.map(([id, w]) => (
              <button key={id} className={`chip${group === id ? ' on' : ''}`} onClick={() => setGroup(id)}>
                {w} <span className="n">{id === 'all' ? all.length : all.filter((g) => groupOf(g) === id).length}</span>
              </button>
            ))}
          </div>
        )}
        {error && <p className="bin-error" role="alert">{error}</p>}
        {items === null ? (
          <div className="nv-skeleton" role="status" aria-label="Reading the Bin" />
        ) : !all.length ? (
          <EmptyState icon="trash" title="Nothing here" line="What you delete stays here for 30 days, so it can come back." />
        ) : (
          <>
            <div className="glabel" style={{ margin: '14px 0 2px' }}>{plural(all.length, 'item')} · Newest first</div>
            <ul className="bin-list-87" aria-label="Bin">
              {shown.map((g) => {
                const back = restored[g.id];
                const title = g.title || g.kindWords || 'Untitled';
                const [tint, glyph] = tileOf(g.kind);
                return (
                  <li key={g.type + g.id} className={`drow2${back ? ' is-back' : ''}`} data-kind={g.kind}>
                    <span className={`gtile xs ${tint}`} aria-hidden="true">{glyph}</span>
                    <div>
                      <div className="t clip">{title}</div>
                      <div className="p clip">
                        {[g.kindWords ?? (g.kind === 'conversation' ? 'Conversation' : g.kind), g.detail && g.detail !== g.kindWords ? g.detail : '', `deleted ${when(g.deletedAt)}`, back ? '' : g.daysLeft <= 1 ? 'gone tomorrow' : `gone in ${g.daysLeft} days`].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                    {asking === g.id ? (
                      <span className="bin-ask is-row" role="alertdialog" aria-label="Delete for good?">
                        <span>Delete “{title}” for good?</span>
                        <button type="button" className="button" autoFocus onClick={() => setAsking(null)}>
                          Cancel
                        </button>
                        <button type="button" className="button danger" disabled={busy === g.id} onClick={() => void act(g, 'purge')}>
                          {busy === g.id ? 'Deleting…' : 'Delete for good'}
                        </button>
                      </span>
                    ) : back ? (
                      <span className="bin-done"><Icon name="check" size={13} /> Restored</span>
                    ) : (
                      <span className="ctl">
                        <button type="button" className="delnow" disabled={!!busy} onClick={() => setAsking(g.id)}>
                          Delete now
                        </button>
                        <button type="button" className="btn" style={{ height: 32 }} disabled={!!busy} onClick={() => void act(g, 'restore')}>
                          {busy === g.id ? 'Restoring…' : 'Restore'}
                        </button>
                      </span>
                    )}
                  </li>
                );
              })}
              {!shown.length && <li className="bin-none">{BIN_EMPTY[group]}</li>}
            </ul>
            <p style={{ fontSize: 13, color: 'var(--text-faint)', marginTop: 12 }}>Delete now and Remove all ask first, here on the page, never in a pop-up.</p>
          </>
        )}
        </div>
      </div>
    </>
  );
}
