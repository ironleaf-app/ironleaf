// Lists' 8.7 pages (30 Oct 2026): the overview (lists.html: every kind's items with their state, the shopping home
// card) and a list's page (lists-shopping.html: still needed, done, the add box). Every ability the old pages had
// lives here: lists started, renamed, their kind changed, cleared, started again and deleted to the Bin; items added,
// changed cell by cell, starred, moved on with a click and taken off; dropped ones kept. One primary button per
// screen.

import { useMemo, useState } from 'react';
import { LIST_FLOW, doneStatus, nextStatus, type ListItem, type ListKind, type ListRecord } from '../../../../../shared/lists';
import { Icon } from '../../../components/Icon';
import { openMenu } from '../../../components/Menu';
import { writeLink } from '../../../lib/links';
import * as A from '../../../state/actions';
import { openTour } from '../../../state/moduleFills';
import { openModule, partOfTab } from '../../../state/modules';
import { toast } from '../../../state/store';
import { useWork } from '../../../state/workModules';
import type * as W from '../../../state/workspace';
import { moneyText } from '../../workspace/recordParts';
import { plural } from '../personal/PersonalParts';
import { dayText } from '../work/WorkShell';
import { addItem, itemMenu, listMenu, newList, openList, setItem, type ListsView } from '../life/ListsPage';
import { Inline, Stars } from '../life/parts';
import { PackReadState, FillsLine, HomeCard, MoreButton, PackHead, PackPage, PageProps, RowsCard, Section, trashRecord, useCanEdit, FULL_DETAILS_LABEL } from './W3b';
import { deleteToBin } from '../../../lib/removeWords';

type Tint = 'slate' | 'green' | 'amber' | 'red' | 'blue';
const KIND_TINT: Record<ListKind, Tint> = { Watching: 'blue', Reading: 'green', Listening: 'blue', Shopping: 'amber', 'Wish list': 'red', Places: 'green', Other: 'slate' };
const stateTone = (i: ListItem): Tint => (i.state === 'done' ? 'green' : i.state === 'doing' ? 'blue' : 'slate');
const metaOf = (i: ListItem) => [i.by, i.where, i.qty && `× ${i.qty}`, i.price !== null ? moneyText(i.price) : '', i.for && `for ${i.for}`, i.note].filter(Boolean).join(' · ');

/** A status tag that moves the item on when clicked. */
function StatusTag({ l, i, canEdit }: { l: ListRecord; i: ListItem; canEdit: boolean }) {
  const next = nextStatus(l.kind, i.status);
  return (
    <button type="button" className={`tag ${stateTone(i)}`} style={{ border: 0, cursor: canEdit && next ? 'pointer' : 'default' }} title={next ? `Mark ${next.toLowerCase()}` : i.status} onClick={() => next && canEdit && void setItem(l, i, { status: next })}>
      {i.status}
    </button>
  );
}

export function ListsOverview({ tab }: { tab: W.TabState }) {
  void tab;
  const canEdit = useCanEdit();
  const { data: m, error } = useWork<ListsView>('lists');
  const kinds = useMemo(() => {
    const seen = new Map<ListKind, ListItem[]>();
    for (const l of m?.lists ?? []) for (const i of l.items) if (i.state === 'open' || i.state === 'doing') { const a = seen.get(l.kind) ?? []; a.push({ ...i, list: l.path } as ListItem & { list: string }); seen.set(l.kind, a); }
    return [...seen.entries()];
  }, [m]);
  const doing = m?.doing.length ?? 0;
  const toBuy = m?.lists.filter((l) => l.kind === 'Shopping').reduce((n, l) => n + l.open, 0) ?? 0;
  const shopping = m?.lists.find((l) => l.kind === 'Shopping' && l.open > 0) ?? m?.lists.find((l) => l.kind === 'Shopping');
  const need = shopping?.items.filter((i) => i.state === 'open') ?? [];
  return (
    <PackPage label="Lists">
      <PackHead glyph="☰" tint="slate" title="Lists" lead="Watch, read, shop, wish and places: each item with a state."
        actions={<>{canEdit && <button type="button" className="btn pri" onClick={() => newList()}>+ New list</button>}<MoreButton label="More for Lists" onOpen={(el) => openMenu(el, [
          { label: 'Under way now', icon: 'play', run: () => openModule('lists', 'next') },
          { label: 'Show the folder', icon: 'folder', disabled: !m, run: () => m && A.revealInExplorer(m.folder) },
          { label: 'Show me around Lists', icon: 'sparkle', run: () => openTour('lists') },
          { separator: true },
          { label: FULL_DETAILS_LABEL, icon: 'history', run: () => openModule('lists', 'classic') },
        ])} /></>} />
      {/* The counts show only once something is under way: zeroes say nothing. */}
      {m && !!kinds.length && <PageProps facts={[{ k: 'In progress', v: `${doing} now watching or reading · ${toBuy} still to buy` }]} />}
      {error && <p className="vsub">{error}</p>}
      {!m && !error && <p className="vsub">Reading your lists…</p>}
      {m && m.lists.length === 0 && <div className="card"><p className="vsub">No lists yet.</p><FillsLine id="lists" /></div>}
      {m && !kinds.length && m.lists.some(list => list.items.length > 0) && <p className="vsub">Everything on every list is done.</p>}
      {!!m?.lists.length && <Section label="Your lists"><div className="card">{m.lists.map(list =>
        <button type="button" className="trow w2a-rowbtn" key={list.path} onClick={() => openList(list.path)}>
          <span className="t">{list.name}</span><span>{plural(list.items.length, 'item')}</span>
        </button>)}</div></Section>}
      {m && kinds.map(([kind, items]) => {
        const lists = m.lists.filter((l) => l.kind === kind);
        return (
          <Section key={kind} label={kind} action={lists.length === 1 ? <button type="button" className="btn quiet" onClick={() => openList(lists[0].path)}>Open {lists[0].name}</button> : undefined}>
            <div className="card" style={{ padding: '6px 20px' }}>
              {items.slice(0, 6).map((i) => {
                const l = m.lists.find((x) => x.path === (i as ListItem & { list: string }).list)!;
                return (
                  <div key={`${l.path}:${i.row}`} className="trow">
                    <button type="button" className="t clip" style={{ background: 'none', border: 0, cursor: 'pointer', font: 'inherit', textAlign: 'left', color: 'var(--text)', fontSize: 15 }} onClick={() => openList(l.path)} title={`Open ${l.name}`}>{i.title}{lists.length > 1 ? ` · ${l.name}` : ''}</button>
                    <span className="meta clip" style={{ marginLeft: 'auto' }}>{metaOf(i)}</span>
                    <StatusTag l={l} i={i} canEdit={canEdit} />
                  </div>
                );
              })}
              {items.length > 6 && <p className="vsub" style={{ padding: '9px 0' }}>{items.length - 6} more on the {lists.length > 1 ? 'lists' : 'list'}.</p>}
            </div>
          </Section>
        );
      })}
      {/* The Home preview shows only what Home shows: shopping with something still needed. */}
      {shopping && need.length > 0 && <HomeCard pack="Shopping" glyph="☰" tint="amber" title={`${need.length} still needed on ${shopping.name.toLowerCase()}`} meta={need.slice(0, 3).map((i) => i.title.toLowerCase()).join(', ') || 'click to tick'} />}
    </PackPage>
  );
}

// ── A list's page ────────────────────────────────────────────────────────────────────────────────────────────────

export function ListDetail({ path }: { path: string }) {
  const canEdit = useCanEdit();
  const { data: m, error, reload } = useWork<ListsView>('lists');
  const [show, setShow] = useState<'todo' | 'done' | 'dropped' | 'all'>('todo');
  const [adding, setAdding] = useState('');
  const l = m?.lists.find((x) => x.path === path);
  if (!m) return <PackReadState label="Lists" error={error} reload={reload}>Reading your lists…</PackReadState>;
  if (!l) return <PackPage label="Lists"><div className="card" style={{ marginTop: 14 }}><p className="vsub">That list isn’t here any more.</p><p style={{ marginTop: 8 }}><button type="button" className="btn" onClick={() => openModule('lists')}>All lists</button></p></div></PackPage>;
  const f = LIST_FLOW[l.kind];
  const todo = [...l.items.filter((i) => i.state === 'doing'), ...l.items.filter((i) => i.state === 'open')];
  const done = l.items.filter((i) => i.state === 'done');
  const dropped = l.items.filter((i) => i.state === 'dropped');
  const needCount = todo.length;
  const totalCount = l.items.length;
  const chips = [{ id: 'todo' as const, label: 'Still needed', n: todo.length }, { id: 'done' as const, label: f.done.join(' or '), n: done.length }, ...(dropped.length ? [{ id: 'dropped' as const, label: 'Dropped', n: dropped.length }] : []), { id: 'all' as const, label: 'Everything', n: l.items.length }];
  const items = show === 'todo' ? todo : show === 'done' ? done : show === 'dropped' ? dropped : l.items;
  const send = () => { const w = adding.trim(); if (!w) return; setAdding(''); void addItem(l, { title: w }).then((ok) => { if (ok && show !== 'todo' && show !== 'all') setShow('todo'); }); };
  const copyLink = () => { void navigator.clipboard.writeText(writeLink(l.path, undefined)).then(() => toast('A link to the list is on the clipboard.')); };
  const row = (i: ListItem, showTag: boolean) => (
    <div key={i.row} className="trow">
      <button type="button" className={`check${i.state === 'done' ? ' done' : ''}`} role="checkbox" aria-checked={i.state === 'done'} aria-label={`${i.title}: ${i.status}`} disabled={!canEdit} onClick={() => void setItem(l, i, { status: i.state === 'done' ? f.statuses[0] : doneStatus(l.kind) })}>{i.state === 'done' ? '✓' : ''}</button>
      <span className="t clip" style={{ minWidth: 0 }}><Inline value={i.title} label="Item" canEdit={canEdit} onSave={(v) => setItem(l, i, { title: v })} /></span>
      {l.columns.includes('rating') && <Stars value={i.rating} canEdit={canEdit} onSave={(n) => void setItem(l, i, { rating: n === null ? '' : String(n) })} />}
      <span className="meta clip" style={{ marginLeft: 'auto' }}>{metaOf(i)}{i.added ? ` · added ${dayText(i.added)}` : ''}</span>
      {showTag && <StatusTag l={l} i={i} canEdit={canEdit} />}
      <button type="button" className="iconbtn" style={{ width: 26, height: 26 }} aria-label={`More for ${i.title}`} onClick={(e) => openMenu(e.currentTarget, itemMenu(l, i, canEdit))}><Icon name="more" size={15} /></button>
    </div>
  );
  return (
    <PackPage label={l.name}>
      <PackHead glyph="☰" tint={KIND_TINT[l.kind]} title={l.name} sharePath={l.path} lead={[l.kind === 'Other' ? 'List' : `${l.kind} list`, l.for && `Shared with ${l.for}`, 'What is still needed shows on Home.'].filter(Boolean).join('. ')}
        actions={<><MoreButton label={`More for ${l.name}`} onOpen={(el) => openMenu(el, [...listMenu(l, canEdit, true), { label: 'Copy link', icon: 'link', run: copyLink }, { separator: true }, { label: deleteToBin('the list'), icon: 'trash', danger: true, disabled: !canEdit, run: () => void trashRecord(l.path).then((ok) => ok && openModule('lists')) }])} /></>} />
      <PageProps facts={[{ k: l.kind === 'Shopping' ? 'Needed' : 'Still to go', v: `${needCount} of ${totalCount}${l.wanted ? ` · wanted things add up to ${moneyText(l.wanted)}` : ''}` }]} />
      <div className="chips" role="group" aria-label="Show items" style={{ marginTop: 12 }}>
        {chips.map((c) => <button key={c.id} type="button" className={`chip${show === c.id ? ' on' : ''}`} aria-pressed={show === c.id} onClick={() => setShow(c.id)}>{c.label} <span className="n">{c.n}</span></button>)}
      </div>
      <Section label={show === 'todo' ? 'Still needed' : show === 'done' ? f.done.join(' or ') : show === 'dropped' ? 'Dropped' : 'Everything'}>
        {/* Bare when there is nothing but the line (t258, the shared RowsCard); the rows keep their card. */}
        <RowsCard empty={!items.length} words={show === 'todo' ? (l.items.length ? `Nothing left to ${f.verb}.` : `Nothing on ${l.name} yet. Add the first ${f.one} below.`) : show === 'done' ? `Nothing is ${f.done[0].toLowerCase()} yet.` : 'Nothing here.'}>
          {items.map((i) => row(i, show === 'all'))}
        </RowsCard>
      </Section>
      {show === 'todo' && !!done.length && (
        <Section label={f.done.join(' or ')}>
          <div className="card" style={{ padding: '6px 20px' }}>{done.slice(0, 5).map((i) => row(i, false))}</div>
        </Section>
      )}
      {canEdit && (
        <div className="ask float" style={{ marginTop: 18 }} role="search" aria-label={`Add to ${l.name}`}>
          <input value={adding} placeholder={`Add to this list…`} aria-label={`Add to ${l.name}`} onChange={(e) => setAdding(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} style={{ border: 0, outline: 0, background: 'none', font: 'inherit', fontSize: 14, width: '100%', color: 'var(--text)' }} />
          <button className="send" title="Add" aria-label="Add" disabled={!adding.trim()} onClick={send}>↑</button>
        </div>
      )}
    </PackPage>
  );
}

/** Lists' page switch: the new overview, a list's new page, the rest as before. */
export function listsPlace(tab: W.TabState): 'overview' | 'list' | 'classic' | 'rest' {
  const part = partOfTab(tab) ?? 'overview';
  if (part === 'classic' || part.startsWith('classic:')) return 'classic';
  if (part.startsWith('list:')) return 'list';
  if (part === 'overview' || part === '') return 'overview';
  return 'rest';
}
export const listPathOf = (tab: W.TabState): string | null => {
  const part = partOfTab(tab) ?? '';
  if (!part.startsWith('list:')) return null;
  try { return decodeURIComponent(part.slice(5)); } catch { return part.slice(5); }
};
