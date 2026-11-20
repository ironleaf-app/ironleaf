// Reading, Watching and Lists' page (Wave 7 part b; src/shared/lists.ts, src/main/life-records/lists.ts). Every list as
// a card with what is next on it and a box to add to it; each list's own page ("list:<path>") with its items in a table
// changed cell by cell, a status that moves on when clicked, stars, and the finished ones folded away; what is under way
// across every list; and every item as a record view. Simple, as asked: lists with a status for each item.

import { useMemo, useState } from 'react';
import { LIST_KINDS, LISTS } from '../../../../../shared/life-records';
import { BY_WORDS, doneStatus, LIST_EDITABLE, LIST_FLOW, listRecords, listSectionViews, listShareText, nextStatus, WHERE_WORDS, type ListItem, type ListKind, type ListRecord, type ListsModel } from '../../../../../shared/lists';
import { partOn } from '../../../../../shared/life-modules';
import { confirm } from '../../../components/Dialogs';
import { EmptyState } from '../../../components/EmptyState';
import { Icon, type IconName } from '../../../components/Icon';
import { openMenu, type MenuItem } from '../../../components/Menu';
import * as A from '../../../state/actions';
import { openModule, partOfTab, useModules } from '../../../state/modules';
import { ListDetail, ListsOverview, listPathOf, listsPlace } from '../w3b/Lists87';
import { useApp } from '../../../state/store';
import { useWork, workCall, workDid } from '../../../state/workModules';
import type * as W from '../../../state/workspace';
import { openRecordForm, valueWords } from '../RecordForm';
import { moneyText } from '../../workspace/recordParts';
import { Card, dayText, openDetail, placeOf, useWorkCtx, WithRecords, WorkShell, WorkViews } from '../work/WorkShell';
import { listsNeeds } from '../../../../../shared/module-purpose';
import { NeedsYou } from '../NeedsYou';
import { hostOf, hrefOf, Inline, plural, QuickAdd, saved, Stars, StatusChip } from './parts';

export type ListsView = ListsModel & { folder: string };

export const LIST_ICON: Record<ListKind, IconName> = { Watching: 'video', Reading: 'book', Listening: 'audio', Shopping: 'receipt', 'Wish list': 'star', Places: 'pin', Other: 'list' };
const call = <T,>(name: string, ...args: unknown[]) => workCall<T>('lists', name, ...args);
export const openList = (rel: string) => openDetail('lists', 'list', rel);

/** "3 to watch · 1 watching · 12 watched". */
export function countWords(l: ListRecord): string {
  const f = LIST_FLOW[l.kind];
  return [l.open ? `${l.open} ${f.statuses[0].toLowerCase()}` : '', l.doing && f.doing ? `${l.doing} ${f.doing.toLowerCase()}` : '', l.done ? `${l.done} ${f.done[0].toLowerCase()}` : ''].filter(Boolean).join(' · ') || 'Nothing on it yet';
}

// ── Doing things ─────────────────────────────────────────────────────────────────────────────────────────────────────

export const setItem = (l: { path: string }, i: ListItem, values: Record<string, unknown>) => saved(call<string | null>('set-item', l.path, i.row, i.title, values));
export const addItem = (l: { path: string }, values: Record<string, string>) => workDid(call<string>('add-item', l.path, values)).then((r) => r !== null);

export function newList(prefill: { kind?: ListKind; name?: string } = {}): void {
  openRecordForm({
    title: 'New list',
    icon: 'list',
    line: 'Shows to watch, books to read, the shopping, a wish list. Each item gets a status you change with a click.',
    ok: 'Start the list',
    fields: [
      { key: 'name', label: 'Name', kind: 'text', required: true, wide: true, placeholder: 'Shows to watch', value: prefill.name ?? '' },
      { key: 'kind', label: 'Kind', kind: 'choice', options: [...LIST_KINDS], value: prefill.kind ?? 'Watching' },
      { key: 'for', label: 'Whose list', kind: 'text', placeholder: 'Leave empty if it’s yours', hint: 'A wish list for someone, or the family’s shopping.' },
    ],
    submit: async (v) => {
      const rel = await call<string>('add-list', { name: valueWords(v, 'name'), kind: valueWords(v, 'kind'), for: valueWords(v, 'for') });
      await workDid(Promise.resolve(rel), `Started ${valueWords(v, 'name')}.`, { label: 'Open', run: () => openList(rel) });
    },
  });
}

/** Every detail of an item, in the form (adding, or changing one already there). */
export function itemForm(l: ListRecord, i?: ListItem): void {
  const f = LIST_FLOW[l.kind];
  const shows = (key: string) => l.columns.includes(key) || (key === 'note' || key === 'link');
  openRecordForm({
    title: i ? i.title : `Add to ${l.name}`,
    icon: LIST_ICON[l.kind],
    ok: i ? 'Save' : 'Add it',
    fields: [
      { key: 'title', label: 'Item', kind: 'text', required: true, wide: true, value: i?.title ?? '' },
      { key: 'status', label: 'Status', kind: 'choice', options: f.statuses, value: i?.status || f.statuses[0] },
      ...(shows('by') ? [{ key: 'by', label: BY_WORDS[l.kind], kind: 'text' as const, value: i?.by ?? '' }] : []),
      ...(shows('where') ? [{ key: 'where', label: WHERE_WORDS[l.kind], kind: 'text' as const, value: i?.where ?? '', placeholder: l.kind === 'Watching' ? 'Netflix, ABC iview…' : undefined }] : []),
      ...(shows('qty') ? [{ key: 'qty', label: 'How many', kind: 'text' as const, value: i?.qty ?? '' }] : []),
      ...(shows('price') ? [{ key: 'price', label: 'Price', kind: 'money' as const, value: i?.price !== null && i?.price !== undefined ? String(i.price) : '' }] : []),
      ...(shows('for') ? [{ key: 'for', label: 'For', kind: 'text' as const, value: i?.for ?? '' }] : []),
      ...(shows('rating') ? [{ key: 'rating', label: 'Rating (1 to 5)', kind: 'number' as const, value: i?.rating ? String(i.rating) : '' }] : []),
      { key: 'link', label: 'Link', kind: 'text', wide: true, value: i?.link ?? '', placeholder: 'https://…' },
      { key: 'note', label: 'Note', kind: 'text', wide: true, value: i?.note ?? '' },
    ],
    submit: async (v) => {
      const values = Object.fromEntries(['title', 'status', 'by', 'where', 'qty', 'price', 'for', 'rating', 'link', 'note'].filter((k) => k in v).map((k) => [k, valueWords(v, k)]));
      if (i) await call('set-item', l.path, i.row, i.title, values);
      else await call('add-item', l.path, values);
      await workDid(Promise.resolve(null), i ? `Saved ${values.title}.` : `Added ${values.title} to ${l.name}.`);
    },
  });
}

export async function renameList(l: ListRecord): Promise<void> {
  const { prompt } = await import('../../../components/Dialogs');
  const name = await prompt('Rename the list', { value: l.name, ok: 'Rename' });
  if (!name || name.trim() === l.name) return;
  const to = await A.renamePath(l.path, name.trim());
  if (to) openList(to);
}

export function listMenu(l: ListRecord, canEdit: boolean, onPage: boolean): MenuItem[] {
  const f = LIST_FLOW[l.kind];
  return [
    ...(onPage ? [] : [{ label: 'Open the list', icon: 'eye' as IconName, run: () => openList(l.path) }]),
    { label: 'Add with every detail…', icon: 'plus', disabled: !canEdit, run: () => itemForm(l) },
    { label: 'Rename…', icon: 'pencil', disabled: !canEdit, run: () => void renameList(l) },
    { label: 'Kind', icon: 'tag', disabled: !canEdit, submenu: LIST_KINDS.map((k) => ({ label: k, checked: l.kind === k, run: () => void workDid(call('set-field', { kind: 'list', path: l.path, field: 'list_kind', value: k }), `${l.name} is a ${k.toLowerCase()} list now.`) })) },
    { separator: true },
    { label: `Take off what’s ${f.done[0].toLowerCase()}`, icon: 'check', disabled: !canEdit || !l.done, run: () => void clearDone(l) },
    { label: `Start again (everything ${f.statuses[0].toLowerCase()})`, icon: 'refresh', disabled: !canEdit || !l.items.some((i) => i.status !== f.statuses[0]), run: () => void workDid(call<string>('restart', l.path)) },
    { separator: true },
    { label: 'Copy as plain words', icon: 'copy', run: () => void saved(navigator.clipboard.writeText(listShareText(l)), `${l.name} copied as plain words.`) },
    { label: 'Open its note', icon: 'notes', run: () => A.openPath(l.path, { where: 'tab' }) },
  ];
}

export async function clearDone(l: ListRecord): Promise<void> {
  const word = LIST_FLOW[l.kind].done[0].toLowerCase();
  if (!(await confirm(`Take ${plural(l.done, `${word} item`)} off ${l.name}?`, { message: 'They stay in the note’s history (File recovery) if you want them back.', ok: 'Take them off' }))) return;
  await workDid(call<string>('clear-done', l.path));
}

export function itemMenu(l: ListRecord, i: ListItem, canEdit: boolean): MenuItem[] {
  return [
    { label: 'Every detail…', icon: 'pencil', disabled: !canEdit, run: () => itemForm(l, i) },
    { label: 'Status', icon: 'flag', disabled: !canEdit, submenu: LIST_FLOW[l.kind].statuses.map((s) => ({ label: s, checked: i.status === s, run: () => void setItem(l, i, { status: s }) })) },
    ...(hrefOf(i.link) ? [{ label: 'Open the link', icon: 'external' as IconName, run: () => window.open(hrefOf(i.link)!, '_blank') }] : []),
    { separator: true },
    { label: 'Take it off the list', icon: 'trash', danger: true, disabled: !canEdit, run: () => void workDid(call<string>('remove-item', l.path, i.row, i.title)) },
  ];
}

// ── Pieces ───────────────────────────────────────────────────────────────────────────────────────────────────────────

function ItemMeta({ i, l }: { i: ListItem; l: ListRecord }) {
  const href = hrefOf(i.link);
  const bits = [i.by && `${BY_WORDS[i.kind] === 'By' ? 'by ' : ''}${i.by}`, i.where, i.qty && `× ${i.qty}`, i.price !== null && moneyText(i.price), i.for && i.for.toLowerCase() !== l.for.toLowerCase() && `for ${i.for}`].filter(Boolean) as string[];
  if (!bits.length && !href && !i.note) return null;
  return (
    <span className="lr-item-meta">
      {bits.join(' · ')}
      {i.note && <span className="lr-item-note">{bits.length ? ' · ' : ''}{i.note}</span>}
      {href && (
        <a className="lr-item-link" href={href} target="_blank" rel="noreferrer" title={href} onClick={(e) => e.stopPropagation()}>
          <Icon name="external" size={11} /> {hostOf(href)}
        </a>
      )}
    </span>
  );
}

function ListCard({ l, canEdit }: { l: ListRecord; canEdit: boolean }) {
  const upNext = [...l.items.filter((i) => i.state === 'doing'), ...l.items.filter((i) => i.state === 'open')];
  const shown = upNext.slice(0, 6);
  return (
    <li className={`lr-list kind-${l.kind.replace(/\s+/g, '-').toLowerCase()}`}>
      <header className="lr-list-head">
        <button type="button" className="lr-list-title" onClick={() => openList(l.path)}>
          <span className="lr-list-icon" aria-hidden="true">
            <Icon name={LIST_ICON[l.kind]} size={15} />
          </span>
          <span className="lr-list-words">
            <span className="lr-list-name">{l.name}</span>
            <span className="lr-list-sub">{[l.for && `For ${l.for}`, countWords(l)].filter(Boolean).join(' · ')}</span>
          </span>
        </button>
        <button type="button" className="icon-button small" aria-label={`More for ${l.name}`} onClick={(e) => openMenu(e.currentTarget, listMenu(l, canEdit, false))}>
          <Icon name="more" size={13} />
        </button>
      </header>
      {shown.length ? (
        <ul className="lr-items">
          {shown.map((i) => (
            <li key={i.row} className={`lr-item is-${i.state}`}>
              <StatusChip status={i.status} next={nextStatus(l.kind, i.status)} canEdit={canEdit} onSet={(s) => void setItem(l, i, { status: s })} />
              <span className="lr-item-words">
                <span className="lr-item-title">{i.title}</span>
                <ItemMeta i={i} l={l} />
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="lr-list-empty">{l.items.length ? `Everything on it is ${LIST_FLOW[l.kind].done[0].toLowerCase()}.` : `Nothing on it yet. Add the first ${LIST_FLOW[l.kind].one}.`}</p>
      )}
      {upNext.length > shown.length && (
        <button type="button" className="lr-more text-button" onClick={() => openList(l.path)}>
          {upNext.length - shown.length} more
        </button>
      )}
      <QuickAdd compact placeholder={`Add to ${l.name}`} canEdit={canEdit} onAdd={(w) => addItem(l, { title: w })} />
    </li>
  );
}

function Starters({ canEdit }: { canEdit: boolean }) {
  const starts: { name: string; kind: ListKind }[] = [
    { name: 'Shows to watch', kind: 'Watching' },
    { name: 'Reading list', kind: 'Reading' },
    { name: 'Shopping', kind: 'Shopping' },
    { name: 'Wish list', kind: 'Wish list' },
  ];
  return (
    <div className="lr-starters">
      {starts.map((s) => (
        <button key={s.name} type="button" className="lr-starter" disabled={!canEdit} onClick={() => void workDid(call<string>('add-list', { name: s.name, kind: s.kind }), `Started ${s.name}.`)}>
          <Icon name={LIST_ICON[s.kind]} size={14} /> {s.name}
        </button>
      ))}
    </div>
  );
}

// ── A list's own page ────────────────────────────────────────────────────────────────────────────────────────────────

const COLUMN_LABEL = (l: ListRecord, key: string) => ({ title: 'Item', status: 'Status', by: BY_WORDS[l.kind], where: WHERE_WORDS[l.kind], qty: 'How many', price: 'Price', for: 'For', rating: 'Rating', link: 'Link', note: 'Note', added: 'Added' })[key] ?? key;

function ListTable({ l, items, canEdit }: { l: ListRecord; items: ListItem[]; canEdit: boolean }) {
  const cols = l.columns.filter((c) => c !== 'title' && c !== 'status');
  const save = (i: ListItem, key: string) => (v: string) => setItem(l, i, { [key]: v });
  return (
    <div className="lr-table-wrap">
      <table className="lr-table">
        <thead>
          <tr>
            <th className="lr-th-status">Status</th>
            <th>Item</th>
            {cols.map((c) => (
              <th key={c} className={`lr-th-${c}`}>
                {COLUMN_LABEL(l, c)}
              </th>
            ))}
            <th aria-label="More" />
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.row} className={`is-${i.state}`}>
              <td className="lr-td-status">
                <StatusChip status={i.status} next={nextStatus(l.kind, i.status)} canEdit={canEdit} onSet={(s) => void setItem(l, i, { status: s })} />
              </td>
              <td className="lr-td-title">
                <Inline value={i.title} label="Item" canEdit={canEdit} onSave={save(i, 'title')} />
              </td>
              {cols.map((c) => (
                <td key={c} className={`lr-td-${c}`}>
                  {c === 'rating' ? (
                    <Stars value={i.rating} canEdit={canEdit} onSave={(n) => void setItem(l, i, { rating: n === null ? '' : String(n) })} />
                  ) : c === 'price' ? (
                    <Inline value={i.price !== null ? String(i.price) : ''} shown={i.price !== null ? moneyText(i.price) : undefined} label="Price" kind="number" canEdit={canEdit} onSave={save(i, 'price')} />
                  ) : c === 'added' ? (
                    <Inline value={i.added ?? ''} shown={i.added ? dayText(i.added) : undefined} label="Added" kind="date" canEdit={canEdit} onSave={save(i, 'added')} />
                  ) : c === 'link' ? (
                    <span className="lr-link-cell">
                      <Inline value={i.link} shown={hrefOf(i.link) ? hostOf(hrefOf(i.link)!) : i.link} label="Link" canEdit={canEdit} placeholder="Add" onSave={save(i, 'link')} />
                      {hrefOf(i.link) && (
                        <a className="icon-button small" href={hrefOf(i.link)!} target="_blank" rel="noreferrer" aria-label={`Open ${hostOf(hrefOf(i.link)!)}`} title="Open in your browser">
                          <Icon name="external" size={12} />
                        </a>
                      )}
                    </span>
                  ) : (
                    <Inline value={(i as unknown as Record<string, string>)[c] ?? ''} label={COLUMN_LABEL(l, c)} canEdit={canEdit} onSave={save(i, c)} />
                  )}
                </td>
              ))}
              <td className="lr-td-end">
                <button type="button" className="icon-button small" aria-label={`More for ${i.title}`} onClick={(e) => openMenu(e.currentTarget, itemMenu(l, i, canEdit))}>
                  <Icon name="more" size={13} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ListPage({ l, canEdit }: { l: ListRecord; canEdit: boolean }) {
  const f = LIST_FLOW[l.kind];
  const [show, setShow] = useState<'todo' | 'done' | 'dropped' | 'all'>('todo');
  const todo = [...l.items.filter((i) => i.state === 'doing'), ...l.items.filter((i) => i.state === 'open')];
  const done = l.items.filter((i) => i.state === 'done');
  const dropped = l.items.filter((i) => i.state === 'dropped');
  const items = show === 'todo' ? todo : show === 'done' ? done : show === 'dropped' ? dropped : l.items;
  const chips = [
    { id: 'todo' as const, label: f.doing ? `To ${f.verb} and ${f.doing.toLowerCase()}` : `To ${f.verb}`, n: todo.length },
    { id: 'done' as const, label: f.done.join(' or '), n: done.length },
    ...(dropped.length ? [{ id: 'dropped' as const, label: 'Dropped', n: dropped.length }] : []),
    { id: 'all' as const, label: 'Everything', n: l.items.length },
  ];
  return (
    <div className="rm-overview lr-listpage">
      <div className="lr-listpage-bar">
        <QuickAdd placeholder={`Add a ${f.one} and press Enter`} canEdit={canEdit} onAdd={(w) => addItem(l, { title: w }).then((ok) => (ok && show !== 'todo' && show !== 'all' && setShow('todo'), ok))} />
        <div className="wm-chips lr-chips" role="group" aria-label="Show items">
          {chips.map((c) => (
            <button key={c.id} type="button" className={`lr-filter${show === c.id ? ' is-on' : ''}`} aria-pressed={show === c.id} onClick={() => setShow(c.id)}>
              {c.label} <span className="lr-filter-n">{c.n}</span>
            </button>
          ))}
        </div>
      </div>
      {l.wanted ? <p className="lr-sum">The wanted things add up to {moneyText(l.wanted)}.</p> : null}
      {items.length ? (
        <ListTable l={l} items={items} canEdit={canEdit} />
      ) : (
        <p className="rm-none lr-none">{show === 'todo' ? (l.items.length ? `Nothing left to ${f.verb}.` : `Nothing on ${l.name} yet. Type above and press Enter to add the first ${f.one}.`) : show === 'done' ? `Nothing is ${f.done[0].toLowerCase()} yet.` : 'Nothing here.'}</p>
      )}
      {show === 'todo' && done.length > 0 && (
        <button type="button" className="text-button lr-show-done" onClick={() => setShow('done')}>
          {plural(done.length, `${f.done[0].toLowerCase()} item`)} folded away
        </button>
      )}
    </div>
  );
}

// ── In progress ──────────────────────────────────────────────────────────────────────────────────────────────────────

function InProgress({ m, canEdit }: { m: ListsView; canEdit: boolean }) {
  if (!m.doing.length) return <EmptyState size="panel" icon="play" title="Nothing under way" line="Mark something Watching, Reading or Listening on a list (click its status) and it shows here." />;
  return (
    <Card id="doing" title="Under way now" count={m.doing.length}>
      <ul className="rm-rows">
        {m.doing.map((i) => {
          const l = m.lists.find((x) => x.path === i.list)!;
          return (
            <li key={`${i.list}:${i.row}`} className="rm-row lr-doing">
              <button type="button" className="rm-row-main" onClick={() => openList(i.list)}>
                <span className="rm-row-icon" aria-hidden="true">
                  <Icon name={LIST_ICON[i.kind]} size={14} />
                </span>
                <span className="rm-row-words">
                  <span className="rm-row-name">{i.title}</span>
                  <span className="rm-row-sub">{[i.listName, i.by, i.where, i.added && `added ${dayText(i.added)}`].filter(Boolean).join(' · ')}</span>
                </span>
              </button>
              <span className="rm-row-end">
                <Stars value={i.rating} canEdit={canEdit} onSave={(n) => void setItem(l, i, { rating: n === null ? '' : String(n) })} />
                <button type="button" className="button small" disabled={!canEdit} onClick={() => void setItem(l, i, { status: doneStatus(i.kind) })}>
                  <Icon name="check" size={12} /> {doneStatus(i.kind)}
                </button>
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

// ── The page ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export function ListsClassic({ tab }: { tab: W.TabState }) {
  const canEdit = useApp((s) => s.canEdit);
  const { section, detail } = placeOf(tab, LISTS);
  const { data: m, error } = useWork<ListsView>('lists');
  const records = useMemo(() => (m ? listRecords(m) : []), [m]);
  const ctx = useWorkCtx('lists', records, { editable: (r) => LIST_EDITABLE[r.kind] ?? [], open: (r) => r.path && openList(r.path) });
  const list = detail?.kind === 'list' && m ? m.lists.find((l) => l.path === detail.key) : undefined;
  const here = detail ? 'overview' : section;
  const more = (): MenuItem[] => [
    { label: 'New list', icon: 'plus', disabled: !canEdit, run: () => newList() },
    ...(list ? [{ separator: true } as MenuItem, ...listMenu(list, canEdit, true)] : []),
    { separator: true },
    { label: 'Show the folder', icon: 'folder', disabled: !m, run: () => m && A.revealInExplorer(m.folder) },
  ];
  const actions = list ? (
    <button type="button" className="sv-tool nt-new" disabled={!canEdit} onClick={() => itemForm(list)}>
      <Icon name="plus" size={14} /> New {LIST_FLOW[list.kind].one}
    </button>
  ) : (
    <button type="button" className="sv-tool nt-new" disabled={!canEdit} onClick={() => newList()}>
      <Icon name="plus" size={14} /> New list
    </button>
  );
  const shownDetail = list ? { title: list.name, line: [list.kind === 'Other' ? 'List' : `${list.kind} list`, list.for && `for ${list.for}`, countWords(list)].filter(Boolean).join(' · '), back: { section: 'overview', label: 'Lists' } } : detail && m ? { title: 'List not found', back: { section: 'overview', label: 'Lists' } } : null;
  return (
    <WithRecords ctx={ctx}>
      <WorkShell tab={tab} module={LISTS} sections={LISTS.sections} here={here} actions={actions} more={more} detail={shownDetail} sharePath={list?.path}>
        {error ? (
          <p className="rm-failed">{error}</p>
        ) : !m ? (
          <div className="view-loading" />
        ) : detail ? (
          list ? <ListPage l={list} canEdit={canEdit} /> : <EmptyState icon="list" title="That list isn’t here any more" line="It may have been renamed, moved or taken out." action={{ label: 'All lists', icon: 'list', run: () => openModule('lists') }} />
        ) : section === 'overview' ? (
          m.lists.length ? (
            <div className="rm-overview">
              <NeedsYou cards={listsNeeds(m.doing.map((i) => ({ title: i.title, listName: i.listName, path: i.list, kind: i.kind })), m.today)} today={m.today} canEdit={canEdit} onAction={(c) => { if (c.ref) openList(c.ref); }} />
              <ul className="lr-lists">
                {m.lists.map((l) => (
                  <ListCard key={l.path} l={l} canEdit={canEdit} />
                ))}
              </ul>
            </div>
          ) : (
            <EmptyState icon="list" title="Lists with a status for each thing" line="Shows to watch, books and articles to read, the shopping, a wish list. Start one, then click an item’s status to move it on." action={{ label: 'Start a list', icon: 'plus', run: () => newList(), disabled: !canEdit }}>
              <Starters canEdit={canEdit} />
            </EmptyState>
          )
        ) : section === 'next' ? (
          <div className="rm-overview">
            <InProgress m={m} canEdit={canEdit} />
          </div>
        ) : (
          <WorkViews module="lists" section={section} made={listSectionViews(section)} records={records} />
        )}
      </WorkShell>
    </WithRecords>
  );
}

// ── The 8.7 page (30 Oct 2026): the new overview and list page, the rest as before ─────────────────────────────────

export function ListsPage({ tab }: { tab: W.TabState }) {
  const place = listsPlace(tab);
  if (place === 'overview') return <ListsOverview tab={tab} />;
  if (place === 'list') { const path = listPathOf(tab); if (path) return <ListDetail path={path} />; }
  if (place === 'classic') { const suffix = (partOfTab(tab) ?? '').startsWith('classic:') ? (partOfTab(tab) ?? '').slice(8) : 'overview'; return <ListsClassic tab={{ ...tab, path: `module:lists#${suffix}` }} />; }
  return <ListsClassic tab={tab} />;
}

// ── Today: what is still needed on the shopping ──────────────────────────────────────────────────────────────────────

export function ListsToday() {
  const modules = useModules();
  const on = partOn(modules, 'lists', 'shopping');
  const { data: m } = useWork<ListsView>('lists', 'model', [], on);
  if (!on || !m) return null;
  const shopping = m.lists.filter((l) => l.kind === 'Shopping' && l.open > 0);
  // What is under way (watching, reading, listening) shows here too (30 Oct 2026, 8.3 wave 1), not only the shopping.
  const doing = m.doing.slice(0, 4);
  if (!shopping.length && !doing.length) return null;
  return (
    <section className="td-section rm-today lr-today" data-section="lists" aria-labelledby="td-h-lists">
      <header className="td-section-head">
        <h2 id="td-h-lists">
          Lists
          {shopping.length > 0 && <span className="td-count">{shopping.reduce((a, l) => a + l.open, 0)}</span>}
        </h2>
        <button type="button" className="td-section-link" onClick={() => openModule('lists')}>
          <Icon name="list" size={13} /> Lists
        </button>
      </header>
      <ul className="rm-today-rows">
        {doing.map((i) => (
          <li key={`${i.list}:${i.row}`} className="rm-today-row">
            <button type="button" className="rm-today-main" onClick={() => openList(i.list)}>
              <span className="rm-today-name">{i.title}</span>
              <span className="rm-today-sub">{i.status} · {i.listName}</span>
            </button>
          </li>
        ))}
        {shopping.slice(0, 3).map((l) => {
          const need = l.items.filter((i) => i.state === 'open');
          return (
            <li key={l.path} className="rm-today-row">
              <button type="button" className="rm-today-main" onClick={() => openList(l.path)}>
                <span className="rm-today-name">{shopping.length === 1 && /^shopping$/i.test(l.name) ? `${plural(need.length, 'thing')} still needed` : `${l.name}: ${need.length} still needed`}</span>
                <span className="rm-today-sub">
                  {need
                    .slice(0, 6)
                    .map((i) => (i.qty ? `${i.title} × ${i.qty}` : i.title))
                    .join(', ')}
                  {need.length > 6 ? ` and ${need.length - 6} more` : ''}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
