// Reading, Watching and Lists on the main side (Wave 7 part b; src/shared/lists.ts). A list is one note, its items the
// rows of its table: an item added is one row, a change is one cell, and every other character stays as written.

import { readTable, tableWithCell, tableWithoutRow, tableWithRow } from '../../shared/personal-records';
import { setNoteProp } from '../../shared/views';
import { LIST_KINDS } from '../../shared/life-records';
import { answerListTool, cleanItem, ITEMS, ITEM_FIELD_OF, itemsSpecFor, kindOf, LIST_FLOW, listsModel, newListText, planListChange, planListCreate, type ListsModel } from '../../shared/lists';
import type { VaultIndex } from '../indexer';
import type { InboxItem } from '../../shared/inbox';
import type { WorkModules, WorkPart } from '../work-modules';
import type { PersonalPart } from '../personal/common';
import { agentChange, agentNote, notesOf, O, refusedCount, removeRow, S, setCells, titleOf } from './common';

export type ListsView = ListsModel & { folder: string };

const TYPES = ['list'];

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const VERBS: [RegExp, (typeof LIST_KINDS)[number]][] = [
  [/^(?:to\s+)?watch\s+/i, 'Watching'],
  [/^(?:to\s+)?read\s+/i, 'Reading'],
  [/^(?:to\s+)?listen\s+to\s+/i, 'Listening'],
  [/^(?:to\s+)?(?:buy|get|pick\s+up)\s+/i, 'Shopping'],
  [/^(?:wish(?:\s+list)?|gift\s+idea)\s*[:-]?\s+/i, 'Wish list'],
];

/** Where an Inbox line would go: the list it names ("… to the shopping list"), else the one list its first word says
 *  ("watch …", "buy …"), else a link goes to the only reading list. The item's words without the list's. */
export function listForInbox(m: ListsModel, item: InboxItem): { list: ListsModel['lists'][number]; title: string; link: string } | null {
  if (item.kind !== 'line') return null;
  let words = item.words.trim();
  const link = /(https?:\/\/\S+)/.exec(words)?.[1] ?? '';
  if (link) words = words.replace(link, '').trim();
  let list = [...m.lists].sort((a, b) => b.name.length - a.name.length).find((l) => new RegExp(`\\b${esc(l.name)}\\b`, 'i').test(words));
  if (list) words = words.replace(new RegExp(`\\s*(?:(?:to|on|for|in|onto)\\s+)?(?:(?:my|the|our)\\s+)?${esc(list.name)}(?:\\s+list)?\\s*[:-]?\\s*`, 'i'), ' ').trim();
  else
    for (const [re, kind] of VERBS) {
      if (!re.test(words)) continue;
      const of = m.lists.filter((l) => l.kind === kind);
      if (of.length === 1) {
        list = of[0];
        words = words.replace(re, '').trim();
      }
      break;
    }
  if (!list && link) {
    const reading = m.lists.filter((l) => l.kind === 'Reading');
    if (reading.length === 1) list = reading[0];
  }
  const title = words.replace(/^(?:please\s+)?(?:add|put)\s+/i, '').replace(/^[:\-–—\s]+|[.\s]+$/g, '').trim() || (link ? link.replace(/^https?:\/\//, '').split('/')[0] : '');
  return list && title ? { list, title: title.slice(0, 200), link } : null;
}

export function makeLists(w: WorkModules): PersonalPart {
  const model = async (index: VaultIndex = w.d.index): Promise<ListsModel> => listsModel(await notesOf(w, index, TYPES), w.today());
  const listAt = async (rel: string) => {
    const m = await model();
    const l = m.lists.find((x) => x.path === rel);
    if (!l) throw new Error('That list isn’t there any more.');
    return { l, m };
  };

  /** A row added to a list (its kind's table made when the note has none yet). */
  const withItem = (text: string, kind: (typeof LIST_KINDS)[number], values: Record<string, string>) => tableWithRow(text, readTable(text, ITEMS).heading ? ITEMS : itemsSpecFor(kind), values);

  const addList = async (input: unknown): Promise<string> => {
    const o = O(input);
    const name = S(o.name, 100);
    if (!name) throw new Error('A list needs a name.');
    const m = await model();
    if (m.lists.some((l) => l.name.toLowerCase() === name.toLowerCase())) throw new Error(`There’s already a list called ${name}.`);
    const kind = kindOf(o.kind);
    const first = Array.isArray(o.items) ? o.items.map((x) => S(x, 200)).filter(Boolean).slice(0, 50).map((title) => ({ title })) : [];
    return w.newNote(await w.folderOf('list'), name, newListText(kind, S(o.for, 80), first, w.todayIso()));
  };

  const addItem = async (rel: unknown, values: unknown): Promise<string> => {
    const { l } = await listAt(S(rel, 1000));
    const v = O(values);
    const title = S(v.title, 200);
    if (!title) throw new Error('Say what to add.');
    const there = l.items.find((i) => i.title.toLowerCase() === title.toLowerCase());
    if (there) throw new Error(`${there.title} is already on ${l.name}${there.status ? ` (${there.status})` : ''}.`);
    const clean = cleanItem(l.kind, { ...v, title, status: S(v.status, 40) || LIST_FLOW[l.kind].statuses[0], added: S(v.added, 20) || w.todayIso() });
    await w.change(l.path, (text) => withItem(text, l.kind, clean));
    return `Added ${title} to ${l.name}.`;
  };

  const setItem = async (rel: unknown, row: unknown, shown: unknown, values: unknown): Promise<string | null> => {
    const { l } = await listAt(S(rel, 1000));
    if (typeof row !== 'number') throw new Error('That item isn’t there any more.');
    const clean = cleanItem(l.kind, O(values));
    if (clean.title === '') throw new Error('An item needs its words.');
    if (!Object.keys(clean).length) return null;
    await setCells(w, l.path, ITEMS, row, typeof shown === 'string' ? shown : null, clean);
    const it = l.items.find((i) => i.row === row);
    if (clean.status && it && LIST_FLOW[l.kind].done.includes(clean.status)) return `${it.title}: ${clean.status.toLowerCase()}.`;
    return null;
  };

  const setField = async (input: unknown): Promise<string | null> => {
    const o = O(input);
    const kind = S(o.kind, 20);
    const rel = S(o.path, 1000);
    const field = S(o.field, 40);
    if (kind === 'list') {
      if (field === 'list_kind') {
        const k = kindOf(o.value);
        await w.change(rel, (text) => setNoteProp(text, 'kind', k));
        return null;
      }
      if (field === 'list_for') {
        await w.change(rel, (text) => setNoteProp(text, 'for', S(o.value, 80) || null));
        return null;
      }
      throw new Error('That can’t be changed here.');
    }
    if (kind !== 'listitem' || !ITEM_FIELD_OF[field]) throw new Error('That can’t be changed here.');
    const ref = O(o.ref);
    return setItem(rel, typeof ref.row === 'number' ? ref.row : o.row, typeof o.title === 'string' ? o.title : null, { [ITEM_FIELD_OF[field]]: o.value === null ? '' : o.value });
  };

  const removeItem = async (rel: unknown, row: unknown, shown: unknown): Promise<string> => {
    const r = S(rel, 1000);
    if (typeof row !== 'number') throw new Error('That item isn’t there any more.');
    const gone = await removeRow(w, r, ITEMS, row, typeof shown === 'string' ? shown : null);
    return `Took ${gone || 'the item'} off ${titleOf(r)}. It is kept in the note’s history (File recovery).`;
  };

  /** Every finished item taken off (the shopping that's been got), in one write. */
  const clearDone = async (rel: unknown): Promise<string> => {
    const { l } = await listAt(S(rel, 1000));
    const done = l.items.filter((i) => i.state === 'done').sort((a, b) => b.row - a.row);
    if (!done.length) throw new Error(`Nothing on ${l.name} is ${LIST_FLOW[l.kind].done[0].toLowerCase()} yet.`);
    await w.change(l.path, (text) => done.reduce((t, i) => tableWithoutRow(t, ITEMS, i.row, i.title).text, text));
    return `Took ${done.length === 1 ? done[0].title : `${done.length} finished items`} off ${l.name}. ${done.length === 1 ? 'It is' : 'They are'} kept in the note’s history (File recovery).`;
  };

  /** Every item put back to the start (a shopping list used again next week). */
  const restart = async (rel: unknown): Promise<string> => {
    const { l } = await listAt(S(rel, 1000));
    const first = LIST_FLOW[l.kind].statuses[0];
    const rows = l.items.filter((i) => i.status !== first);
    if (!rows.length) throw new Error(`Everything on ${l.name} is already ${first.toLowerCase()}.`);
    await w.change(l.path, (text) => rows.reduce((t, i) => setCellsIn(t, i.row, i.title, { status: first }), text));
    return `Every item on ${l.name} is ${first.toLowerCase()} again.`;
  };

  const ops: WorkPart['ops'] = {
    model: async (): Promise<ListsView> => ({ ...(await model()), folder: await w.moduleFolder('lists') }),
    'add-list': (input) => addList(input),
    'add-item': (rel, values) => addItem(rel, values),
    'set-item': (rel, row, shown, values) => setItem(rel, row, shown, values),
    'set-field': (input) => setField(input),
    'remove-item': (rel, row, shown) => removeItem(rel, row, shown),
    'clear-done': (rel) => clearDone(rel),
    restart: (rel) => restart(rel),
  };

  return {
    id: 'lists',
    ops,
    async inbox(item) {
      const hit = listForInbox(await model(), item);
      if (!hit) return null;
      return { target: { kind: 'module', module: 'lists', type: 'list', path: hit.list.path, name: hit.list.name, label: `Add to ${hit.list.name}` }, why: `Adds “${hit.title}” to ${hit.list.name}` };
    },
    async fileInbox(item, target) {
      const m = await model();
      const hit = listForInbox(m, item);
      const l = m.lists.find((x) => x.path === target.path) ?? hit?.list;
      if (!l || !hit) throw new Error('That list isn’t there any more.');
      if (l.items.some((i) => i.title.toLowerCase() === hit.title.toLowerCase())) return { words: `${hit.title} is already on ${l.name}.`, paths: [l.path] };
      await w.change(l.path, (text) => withItem(text, l.kind, cleanItem(l.kind, { title: hit.title, status: LIST_FLOW[l.kind].statuses[0], link: hit.link, added: m.today })));
      return { words: `Added ${hit.title} to ${l.name}.`, paths: [l.path] };
    },
    async tool(name, args, ctx) {
      const mine = await model(ctx.gated);
      const refused = await refusedCount(w, ctx, TYPES);
      if (name === 'list_overview' || name === 'list_get' || name === 'list_share' || name === 'list_next') return answerListTool({ model: mine, on: w.isOn('lists'), refused, agent: ctx.agent }, name, args) ?? `There is no tool called ${name}.`;
      if (name === 'list_create') {
        const made = planListCreate(args, { on: w.isOn('lists'), model: mine });
        const rel = await agentNote(w, ctx, await w.folderOf('list'), made.name, made.text);
        return `${made.words} [${rel}]`;
      }
      const plan = planListChange(name, args, { on: w.isOn('lists'), model: mine });
      const l = mine.lists.find((x) => x.path === plan.path)!;
      if (plan.add) await agentChange(w, ctx, plan.path, (text) => withItem(text, l.kind, plan.add!));
      else if (plan.set) await agentChange(w, ctx, plan.path, (text) => setCellsIn(text, plan.set!.row, plan.set!.title, plan.set!.values));
      return `${plan.words} [${plan.path}]`;
    },
    rules: () => 'Lists: use list_overview and list_get for the person’s watch lists, reading lists, shopping and wish lists; start a list with list_create, add with list_add_item (shopping adds up: the same thing again is more of it), change a status with list_set_status and naming the list or its kind, and only with what the person said (never guess a link, price or author). list_share writes one list out as plain words to share.',
  };
}

/** Several cells of one row changed in a note's words (the row checked by its title first). */
function setCellsIn(text: string, row: number, title: string, values: Record<string, string>): string {
  return Object.entries(values).reduce((t, [k, v], i) => tableWithCell(t, ITEMS, row, i === 0 ? title : null, k, v), text);
}
