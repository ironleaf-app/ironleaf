// Reading, Watching and Lists (Wave 7 part b, 24 Oct 2026; module 21 of the catalogue: "Shows, articles, shopping, wish
// lists · Simple lists with status · Personal"). One note per list, its items a table the person can edit by hand:
//
//   Me/Lists/Shows to watch.md     type: list — kind: Watching, for (whose list, when it isn't the person's own);
//                                  "## Items" | Item | Status | Where | Rating | Link | Note | Added |
//
// The columns are read by their names in any order (a hand-made table with "Show | Status | Notes" works), missing ones
// read as empty, extra ones are kept. Each kind of list has its own statuses (a watch list goes To watch, Watching,
// Watched; shopping goes Need, Got) and its own columns; a status written by hand that isn't one of them is kept and
// shown as written. Pure: no files, no Node, no DOM.

import { LIST_KINDS } from './life-records';
import { defaultRecordView, type RecordViewDef } from './record-views';
import type { WsRecord } from './workspace-records';
import type { WorkToolDef } from './work-module-tools';
import { cleanCell, dayWords, findByName, join, knownWord, moneyWords, plural, readAmount, readDay, readTable, refusedWords, str, todayOf, type TableField, type TableSpec } from './personal-records';

export type ListKind = (typeof LIST_KINDS)[number];

/** Each kind's statuses, in the order an item moves through them, and which of them count as finished or dropped. */
export const LIST_FLOW: Record<ListKind, { statuses: string[]; done: string[]; dropped?: string; doing?: string; verb: string; one: string }> = {
  Watching: { statuses: ['To watch', 'Watching', 'Watched', 'Dropped'], done: ['Watched'], dropped: 'Dropped', doing: 'Watching', verb: 'watch', one: 'show' },
  Reading: { statuses: ['To read', 'Reading', 'Read', 'Dropped'], done: ['Read'], dropped: 'Dropped', doing: 'Reading', verb: 'read', one: 'book or article' },
  Listening: { statuses: ['To listen', 'Listening', 'Listened', 'Dropped'], done: ['Listened'], dropped: 'Dropped', doing: 'Listening', verb: 'listen to', one: 'album or podcast' },
  Shopping: { statuses: ['Need', 'Got'], done: ['Got'], verb: 'buy', one: 'thing' },
  'Wish list': { statuses: ['Wanted', 'Bought', 'Received'], done: ['Bought', 'Received'], verb: 'get', one: 'wish' },
  Places: { statuses: ['To go', 'Been'], done: ['Been'], verb: 'go to', one: 'place' },
  Other: { statuses: ['To do', 'Doing', 'Done'], done: ['Done'], doing: 'Doing', verb: 'do', one: 'item' },
};

/** The columns each kind of list starts with (a hand-made table keeps its own). */
export const LIST_COLUMNS: Record<ListKind, string[]> = {
  Watching: ['title', 'status', 'where', 'rating', 'link', 'note', 'added'],
  Reading: ['title', 'status', 'by', 'rating', 'link', 'note', 'added'],
  Listening: ['title', 'status', 'by', 'where', 'link', 'note', 'added'],
  Shopping: ['title', 'status', 'qty', 'where', 'note', 'added'],
  'Wish list': ['title', 'status', 'price', 'for', 'link', 'note', 'added'],
  Places: ['title', 'status', 'where', 'link', 'note', 'added'],
  Other: ['title', 'status', 'link', 'note', 'added'],
};

/** What "Where" means on each kind ("On" for a show, "Shop" for shopping). */
export const WHERE_WORDS: Record<ListKind, string> = { Watching: 'On', Reading: 'Where', Listening: 'On', Shopping: 'Shop', 'Wish list': 'Where', Places: 'Where', Other: 'Where' };
export const BY_WORDS: Record<ListKind, string> = { Watching: 'By', Reading: 'Author', Listening: 'Artist', Shopping: 'By', 'Wish list': 'By', Places: 'By', Other: 'By' };

export const ITEM_FIELDS: TableField[] = [
  { key: 'title', label: 'Item', col: /^(item|name|title|what|show|film|movie|book|article|album|podcast|thing|place)$/i, kind: 'text' },
  { key: 'status', label: 'Status', col: /^(status|state)$/i, kind: 'text' },
  { key: 'by', label: 'By', col: /^(by|author|artist|creator|director|host|writer)$/i, kind: 'text' },
  { key: 'where', label: 'Where', col: /^(where|on|service|platform|channel|shop|store)$/i, kind: 'text' },
  { key: 'qty', label: 'Qty', col: /^(qty|quantity|how many|amount)$/i, kind: 'text' },
  { key: 'price', label: 'Price', col: /^(price|cost)$/i, kind: 'money' },
  { key: 'for', label: 'For', col: /^(for|who|whose)$/i, kind: 'text' },
  { key: 'rating', label: 'Rating', col: /^(rating|stars|score)$/i, kind: 'number' },
  { key: 'link', label: 'Link', col: /^(link|url|web|website)$/i, kind: 'text' },
  { key: 'note', label: 'Note', col: /^(notes?|comments?)$/i, kind: 'text' },
  { key: 'added', label: 'Added', col: /^(added|date added|date)$/i, kind: 'date' },
];

export const ITEMS: TableSpec = { id: 'items', name: 'Items', heading: /^(items?|list|the list|to watch|to read|shopping)$/i, fields: ITEM_FIELDS, title: 'title', one: 'item' };

/** A kind's table: its columns in their order (for a new list). */
export const itemsSpecFor = (kind: ListKind): TableSpec => ({ ...ITEMS, fields: LIST_COLUMNS[kind].map((k) => ITEM_FIELDS.find((f) => f.key === k)!) });

// ── The model ────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface ListNote {
  path: string;
  title: string;
  props: Record<string, unknown>;
  content: string;
}

export interface ListItem {
  row: number;
  title: string;
  status: string;
  /** Finished (watched, read, got…), dropped, under way (watching, reading…), or still to do. */
  state: 'open' | 'doing' | 'done' | 'dropped';
  by: string;
  where: string;
  qty: string;
  price: number | null;
  for: string;
  /** 1 to 5, when given. */
  rating: number | null;
  link: string;
  note: string;
  added: string | null;
  list: string;
  listName: string;
  kind: ListKind;
}

export interface ListRecord {
  path: string;
  name: string;
  kind: ListKind;
  for: string;
  items: ListItem[];
  /** The columns the note's table has (fields), so a page shows those and a new item fills them. */
  columns: string[];
  open: number;
  doing: number;
  done: number;
  dropped: number;
  /** What a wish list's wanted things add up to. */
  wanted: number | null;
}

export interface ListsModel {
  lists: ListRecord[];
  /** Under way across every list (watching, reading, listening, doing). */
  doing: ListItem[];
  today: string;
}

export const kindOf = (v: unknown): ListKind => {
  const k = knownWord(LIST_KINDS, v);
  return (LIST_KINDS as readonly string[]).includes(k) ? (k as ListKind) : 'Other';
};

/** An item's state from its status word on its kind of list (a status written by hand reads as open unless it says done). */
export function stateOf(kind: ListKind, status: string): ListItem['state'] {
  const f = LIST_FLOW[kind];
  const s = status.toLowerCase();
  if (!s) return 'open';
  if (f.done.some((d) => d.toLowerCase() === s) || /^(done|finished|complete|completed|watched|read|got|bought|been|received|listened)$/.test(s)) return 'done';
  if ((f.dropped && f.dropped.toLowerCase() === s) || /^(dropped|gave up|abandoned|not for me)$/.test(s)) return 'dropped';
  if ((f.doing && f.doing.toLowerCase() === s) || /^(watching|reading|listening|doing|in progress|started)$/.test(s)) return 'doing';
  return 'open';
}

/** The status an item moves to next when its chip is clicked (dropped items come back to the start). */
export function nextStatus(kind: ListKind, status: string): string {
  const f = LIST_FLOW[kind].statuses.filter((s) => s !== LIST_FLOW[kind].dropped);
  const i = f.findIndex((s) => s.toLowerCase() === status.toLowerCase());
  return i < 0 || i === f.length - 1 ? f[0] : f[i + 1];
}

/** The status that finishes an item on its kind of list ("Watched", "Got"). */
export const doneStatus = (kind: ListKind) => LIST_FLOW[kind].done[0];

export function readList(n: ListNote): ListRecord {
  const kind = kindOf(n.props.kind);
  const t = readTable(n.content, ITEMS);
  const columns = ITEM_FIELDS.filter((f) => t.cols[f.key] >= 0).map((f) => f.key);
  const items: ListItem[] = t.rows.map(({ row, values: v }) => {
    const status = v.status ? knownWord(LIST_FLOW[kind].statuses, v.status) : '';
    const rating = Number(v.rating);
    return {
      row,
      title: v.title,
      status: status || (t.cols.status >= 0 ? LIST_FLOW[kind].statuses[0] : ''),
      state: stateOf(kind, status),
      by: v.by,
      where: v.where,
      qty: v.qty,
      price: readAmount(v.price),
      for: v.for,
      rating: Number.isFinite(rating) && v.rating !== '' ? Math.max(0, Math.min(5, Math.round(rating))) : /^★+/.test(v.rating) ? v.rating.replace(/[^★]/g, '').length : null,
      link: v.link.replace(/^<|>$/g, ''),
      note: v.note,
      added: readDay(v.added),
      list: n.path,
      listName: n.title,
      kind,
    };
  });
  const count = (s: ListItem['state']) => items.filter((i) => i.state === s).length;
  const wanted = kind === 'Wish list' ? items.filter((i) => i.state === 'open' && i.price !== null).reduce((a, i) => a + (i.price ?? 0), 0) : null;
  return { path: n.path, name: n.title, kind, for: str(n.props.for), items, columns: columns.length ? columns : LIST_COLUMNS[kind], open: count('open'), doing: count('doing'), done: count('done'), dropped: count('dropped'), wanted };
}

const KIND_ORDER: ListKind[] = ['Watching', 'Reading', 'Listening', 'Shopping', 'Wish list', 'Places', 'Other'];

export function listsModel(notes: readonly ListNote[], today: Date | string = new Date()): ListsModel {
  const lists = notes.map(readList).sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.name.localeCompare(b.name));
  return { lists, doing: lists.flatMap((l) => l.items.filter((i) => i.state === 'doing')), today: todayOf(today) };
}

// ── New notes and rows ───────────────────────────────────────────────────────────────────────────────────────────────

/** A new list's words: its kind, whose it is, and its table with that kind's columns (and any first items). */
export function newListText(kind: ListKind, forWho = '', first: { title: string; status?: string }[] = [], today = ''): string {
  const spec = itemsSpecFor(kind);
  const head = spec.fields.map((f) => f.label.replace(/^Where$/, WHERE_WORDS[kind]).replace(/^By$/, BY_WORDS[kind]));
  const rows = first.map((i) => `| ${spec.fields.map((f) => (f.key === 'title' ? i.title.replace(/\|/g, '\\|') : f.key === 'status' ? i.status || LIST_FLOW[kind].statuses[0] : f.key === 'added' ? today : '') || ' ').join(' | ')} |`);
  const front = ['---', 'type: list', `kind: ${kind === 'Wish list' ? '"Wish list"' : kind}`, forWho ? `for: ${JSON.stringify(forWho)}` : 'for:', '---'];
  return `${front.join('\n')}\n## Items\n\n| ${head.join(' | ')} |\n| ${head.map(() => '---').join(' | ')} |\n${rows.map((r) => `${r}\n`).join('')}`;
}

/** An item's cells checked for its list (a status one of the kind's words when it reads as one; a rating 0 to 5). */
export function cleanItem(kind: ListKind, values: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of ITEM_FIELDS) {
    const raw = values[f.key];
    if (raw === undefined || raw === null) continue;
    if (f.key === 'status') out.status = knownWord(LIST_FLOW[kind].statuses, raw);
    else if (f.key === 'rating') {
      const s = str(raw);
      if (!s) out.rating = '';
      else {
        const n = Number(s);
        if (!Number.isFinite(n) || n < 0 || n > 5) throw new Error('Give a rating from 1 to 5 (or leave it empty).');
        out.rating = String(Math.round(n));
      }
    } else out[f.key] = cleanCell(f, raw);
  }
  return out;
}

// ── Records for the views ────────────────────────────────────────────────────────────────────────────────────────────

export function listRecords(m: ListsModel): WsRecord[] {
  const out: WsRecord[] = [];
  for (const l of m.lists) {
    out.push({ id: `${l.path}::list`, kind: 'list', title: l.name, path: l.path, fields: { list_kind: l.kind, list_for: l.for || null, to_do: l.open + l.doing, finished: l.done, items: l.items.length }, links: [], ref: { at: 'note', path: l.path } });
    const cols = Object.fromEntries(ITEM_FIELDS.map((f) => [f.key, -1]));
    for (const i of l.items)
      out.push({
        id: `${l.path}::item:${i.row}`,
        kind: 'listitem',
        title: i.title || `Item ${i.row + 1}`,
        path: l.path,
        fields: { list: l.name, list_kind: l.kind, status: i.status || null, by_who: i.by || null, where_on: i.where || null, qty: i.qty || null, price: i.price, for_who: i.for || null, rating: i.rating, link: i.link || null, note: i.note || null, added: i.added },
        links: [`${l.path}::list`],
        ref: { at: 'table', heading: 'Items', row: i.row, cols },
      });
  }
  return out;
}

/** The fields each kind can change where it shows (a record's field → the table's field). */
export const LIST_EDITABLE: Record<string, string[]> = {
  list: ['list_kind', 'list_for'],
  listitem: ['title', 'status', 'by_who', 'where_on', 'qty', 'price', 'for_who', 'rating', 'link', 'note', 'added'],
};
export const ITEM_FIELD_OF: Record<string, string> = { title: 'title', status: 'status', by_who: 'by', where_on: 'where', qty: 'qty', price: 'price', for_who: 'for', rating: 'rating', link: 'link', note: 'note', added: 'added' };

export function listSectionViews(section: string): RecordViewDef[] {
  const v = (kinds: WsRecord['kind'][], layout: RecordViewDef['layout'], title: string, patch: Partial<RecordViewDef> = {}): RecordViewDef => ({ ...defaultRecordView(kinds, layout, title), scope: 'vault', showDone: true, ...patch });
  if (section === 'items') return [v(['listitem'], 'table', 'Every item', { fields: ['status', 'by_who', 'where_on', 'rating', 'note', 'added'], groupBy: 'list', sort: { field: 'added', dir: 'desc' } })];
  return [];
}

// ── The agent tools ──────────────────────────────────────────────────────────────────────────────────────────────────

export const LIST_TOOLS: WorkToolDef[] = [
  {
    name: 'list_next',
    module: 'lists',
    write: false,
    title: 'What is next on each list',
    step: 'Looked at what is next on each list',
    description: 'What is next on each of the person’s lists: the thing under way now (watching, reading, listening), else the first thing still to do, and how much shopping is still needed. Use it for "what should I watch tonight?", "what is left to get?".',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_overview',
    module: 'lists',
    write: false,
    title: 'Lists',
    step: 'Looked through your lists',
    description: 'Every list (Ironleaf): watch lists, reading lists, shopping, wish lists, places, with how many items are to do, under way and finished, and what is under way now. Use it for "what am I watching?", "what lists do I have?".',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_get',
    module: 'lists',
    write: false,
    title: 'A list',
    step: 'Read a list',
    description: 'One list’s items with their status and details (where, who by, rating, price, note). Name the list, or its kind ("watch list", "shopping", "reading"). Use it for "what’s on the shopping list?", "what was on my reading list?".',
    parameters: { type: 'object', properties: { list: { type: 'string', description: 'The list’s name, or its kind (watch list, reading list, shopping, wish list).' }, status: { type: 'string', description: 'Only items with this status (To watch, Need…), or "open" for everything not finished.' } }, required: ['list'], additionalProperties: false },
  },
  {
    name: 'list_create',
    module: 'lists',
    write: true,
    title: 'Start a list',
    step: 'Started a list',
    description: 'Start a new list: its name, its kind (Watching, Reading, Listening, Shopping, Wish list, Places, Other) and whose it is when it isn’t the person’s own. The window’s New list, for an assistant.',
    parameters: { type: 'object', properties: { name: { type: 'string', description: 'The list’s name ("Weekend films", "Groceries").' }, kind: { type: 'string', enum: [...LIST_KINDS] }, for: { type: 'string', description: 'Whose list it is (optional).' } }, required: ['name'], additionalProperties: false },
  },
  {
    name: 'list_share',
    module: 'lists',
    write: false,
    title: 'A list as plain words',
    step: 'Wrote a list out as plain words',
    description: 'One list written out as plain words to share (its name, then each item still to do, then what is finished), ready to paste into a message. Name the list, or its kind.',
    parameters: { type: 'object', properties: { list: { type: 'string', description: 'The list’s name, or its kind (watch list, reading list, shopping, wish list).' } }, required: ['list'], additionalProperties: false },
  },
  {
    name: 'list_add_item',
    module: 'lists',
    write: true,
    title: 'Add to a list',
    step: 'Added to a list',
    description: 'Add an item to one of the person’s lists (a show to watch, a book or article to read, something to buy, a wish). Name the list or its kind; give only what the person said (never guess a link, price or author).',
    parameters: {
      type: 'object',
      properties: {
        list: { type: 'string', description: 'The list’s name, or its kind (watch list, reading list, shopping, wish list).' },
        item: { type: 'string' },
        status: { type: 'string' },
        by: { type: 'string', description: 'Author, artist or creator.' },
        where: { type: 'string', description: 'Where to watch, listen or buy it.' },
        qty: { type: 'string' },
        price: { type: 'string' },
        for: { type: 'string', description: 'Who it is for (a wish list).' },
        link: { type: 'string' },
        note: { type: 'string' },
      },
      required: ['list', 'item'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_set_status',
    module: 'lists',
    write: true,
    title: 'Change an item’s status',
    step: 'Changed an item on a list',
    description: 'Set an item’s status on one of the person’s lists ("watched", "got", "reading"), and a rating from 1 to 5 when the person gave one.',
    parameters: { type: 'object', properties: { list: { type: 'string' }, item: { type: 'string' }, status: { type: 'string' }, rating: { type: 'number' } }, required: ['list', 'item', 'status'], additionalProperties: false },
  },
];

const OFF = 'The Lists module is off in Ironleaf (Settings › Packs). Say so; don’t guess at the person’s lists.';

const KIND_WORDS: [RegExp, ListKind][] = [
  [/watch|show|film|movie|tv|series/i, 'Watching'],
  [/read|book|article/i, 'Reading'],
  [/listen|podcast|album|music/i, 'Listening'],
  [/shop|grocer|buy|supermarket/i, 'Shopping'],
  [/wish|gift|present/i, 'Wish list'],
  [/place|travel|visit|go to/i, 'Places'],
];

/** The list some words mean: its name, else the only list of the kind the words say ("watch list" → the Watching list). */
export function findList(m: ListsModel, words: unknown): ListRecord | undefined {
  const byName = findByName(m.lists, words, (l) => [l.name]);
  if (byName) return byName;
  const w = str(words);
  const kind = KIND_WORDS.find(([re]) => re.test(w))?.[1];
  if (!kind) return undefined;
  const of = m.lists.filter((l) => l.kind === kind);
  return of.length === 1 ? of[0] : undefined;
}

export function findItem(l: ListRecord, words: unknown): ListItem | undefined {
  return findByName(l.items, words, (i) => [i.title]);
}

/** A list as plain words to share (30 Oct 2026, 8.3 wave 1): still to do first, finished after, no table marks. */
export function listShareText(l: ListRecord): string {
  const open = l.items.filter((i) => i.state === 'open' || i.state === 'doing');
  const done = l.items.filter((i) => i.state === 'done');
  const line = (i: ListItem) => `- ${i.title}${i.qty ? ` × ${i.qty}` : ''}${i.where ? ` (${i.where})` : ''}${i.rating ? ` (${i.rating}/5)` : ''}`;
  return [`${l.name}${l.for ? ` (for ${l.for})` : ''}:`, ...(open.length ? open.map(line) : ['Nothing still to do.']), ...(done.length ? ['', 'Done:', ...done.map(line)] : [])].join('\n');
}

const itemLine = (i: ListItem, today: string) =>
  `- ${i.title}${i.status ? ` (${i.status})` : ''}${i.by ? `, ${BY_WORDS[i.kind].toLowerCase()} ${i.by}` : ''}${i.where ? `, ${WHERE_WORDS[i.kind].toLowerCase()} ${i.where}` : ''}${i.qty ? `, ${i.qty}` : ''}${i.price !== null ? `, ${moneyWords(i.price)}` : ''}${i.for ? `, for ${i.for}` : ''}${i.rating ? `, ${i.rating}/5` : ''}${i.note ? ` — ${i.note}` : ''}${i.added ? ` [added ${dayWords(i.added, today)}]` : ''}`;

export interface ListToolInput {
  model: ListsModel;
  on: boolean;
  refused?: number;
  agent?: string;
}

/** The answer to one of the read tools (null: not one of them). */
export function answerListTool(input: ListToolInput, name: string, args: Record<string, unknown> = {}): string | null {
  const tool = LIST_TOOLS.find((t) => t.name === name);
  if (!tool || tool.write) return null;
  if (!input.on) return OFF;
  const m = input.model;
  const refused = refusedWords(input.refused, 'list', input.agent);
  if (name === 'list_next') {
    if (!m.lists.length) return join(['No lists yet.', refused]);
    const lines = m.lists.map((l) => {
      const doing = l.items.find((i) => i.state === 'doing');
      const open = l.items.find((i) => i.state === 'open');
      const next = doing ?? open;
      return `- ${l.name} (${l.kind}): ${l.kind === 'Shopping' ? `${l.open} still needed${next ? `, next ${next.title}` : ''}` : next ? `${doing ? 'under way' : 'next'}: ${next.title}${next.status ? ` (${next.status})` : ''}` : 'nothing left to do'} [${l.path}]`;
    });
    return join(['What is next:', ...lines, refused]);
  }
  if (name === 'list_overview') {
    if (!m.lists.length) return join(['No lists yet.', refused]);
    return join([
      `${plural(m.lists.length, 'list')}:`,
      ...m.lists.map((l) => `- ${l.name} (${l.kind}${l.for ? `, for ${l.for}` : ''}): ${l.open} to ${LIST_FLOW[l.kind].verb}${l.doing ? `, ${l.doing} under way` : ''}, ${l.done} finished${l.wanted ? `; wanted things add up to ${moneyWords(l.wanted)}` : ''} [${l.path}]`),
      m.doing.length ? `Under way now: ${m.doing.map((i) => `${i.title} (${i.listName})`).join(', ')}.` : '',
      refused,
    ]);
  }
  if (name === 'list_share') {
    const l = findList(m, args.list);
    if (!l) return join([`There is no list called “${str(args.list)}”.${m.lists.length ? ` Lists: ${m.lists.map((x) => `${x.name} (${x.kind})`).join(', ')}.` : ' There are no lists yet.'}`, refused]);
    return listShareText(l);
  }
  if (name === 'list_get') {
    const l = findList(m, args.list);
    if (!l) return join([`There is no list called “${str(args.list)}”.${m.lists.length ? ` Lists: ${m.lists.map((x) => `${x.name} (${x.kind})`).join(', ')}.` : ' There are no lists yet.'}`, refused]);
    const want = str(args.status).toLowerCase();
    const items = l.items.filter((i) => !want || (want === 'open' ? i.state === 'open' || i.state === 'doing' : i.status.toLowerCase() === want));
    return join([`${l.name} (${l.kind}${l.for ? `, for ${l.for}` : ''}): ${plural(items.length, 'item')}${want ? ` (${want})` : ''}. [${l.path}]`, ...items.slice(0, 120).map((i) => itemLine(i, m.today)), items.length > 120 ? `- … and ${items.length - 120} more` : '', refused]);
  }
  return null;
}

export interface PlannedListChange {
  path: string;
  /** The values for a new row, or the row and cell changes for an item already there. */
  add?: Record<string, string>;
  set?: { row: number; title: string; values: Record<string, string> };
  words: string;
}

/** One word stemmed ("eggs" → "egg", "berries" → "berry", "classes" → "class"); "glass" and "cheese" stay whole. */
function stemWord(w: string): string {
  if (w.endsWith('ies') && w.length > 4) return `${w.slice(0, -3)}y`;
  if (/(s|x|z|ch|sh|o)es$/.test(w) && w.length > 4) return w.slice(0, -2);
  if (w.endsWith('s') && !/(ss|us|is)$/.test(w) && w.length > 3) return w.slice(0, -1);
  return w;
}

/** Titles compared by their stemmed words, so "egg" is more "Eggs", never a second row. */
function matchKey(title: string): string {
  return String(title ?? '').toLowerCase().replace(/\s+/g, ' ').trim().split(' ').map(stemWord).join(' ');
}

/** A quantity as a number with its unit ("500g" → 500 "g"); missing counts as 1, anything else is unreadable. */
function qtyOf(v: unknown): { n: number; unit: string } | null {
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) return { n: 1, unit: '' };
  const m = /^(\d+(?:\.\d+)?)\s*([a-z%]*)$/.exec(s);
  return m ? { n: Number(m[1]), unit: m[2] } : null;
}

/** list_add_item and list_set_status's change, from their arguments. Throws in plain words an agent can pass on. */
export function planListChange(name: string, args: Record<string, unknown>, ctx: { on: boolean; model: ListsModel }): PlannedListChange {
  if (!ctx.on) throw new Error(OFF);
  const l = findList(ctx.model, args.list);
  if (!l) throw new Error(`There is no list called “${str(args.list)}”.${ctx.model.lists.length ? ` Lists: ${ctx.model.lists.map((x) => x.name).join(', ')}.` : ' The person can start one in Ironleaf › Lists.'}`);
  const item = str(args.item).slice(0, 200);
  if (!item) throw new Error('Say which item.');
  const there = findItem(l, item);
  if (name === 'list_add_item') {
    // Shopping adds up (30 Oct 2026, 8.3 wave 1): the same thing again is more of it, never a second row. The same
    // unit adds with its unit kept ("500g" and "500g" is "1000g"); quantities that don't add ("500g" and one more)
    // are both kept, never mushed to 501.
    const exact = there && there.title.toLowerCase() === item.toLowerCase() ? there : undefined;
    const same = exact ?? (l.kind === 'Shopping' ? l.items.find((i) => matchKey(i.title) === matchKey(item)) : undefined);
    if (same && l.kind === 'Shopping' && same.state !== 'done' && same.state !== 'dropped') {
      const a = qtyOf(same.qty);
      const b = qtyOf(args.qty);
      if (a && b && a.unit === b.unit) {
        const qty = `${Math.round((a.n + b.n) * 100) / 100}${a.unit}`;
        return { path: l.path, set: { row: same.row, title: same.title, values: { qty } }, words: `${same.title} on ${l.name}: ${qty} now (added up).` };
      }
      const qty = `${String(same.qty || '1')} + ${String(args.qty ?? '').trim() || '1'}`;
      return { path: l.path, set: { row: same.row, title: same.title, values: { qty } }, words: `${same.title} on ${l.name}: ${qty} (different quantities kept).` };
    }
    const dup = exact ?? (same && l.kind === 'Shopping' ? same : undefined);
    if (dup) throw new Error(`${dup.title} is already on ${l.name}${dup.status ? ` (${dup.status})` : ''}.`);
    const values = cleanItem(l.kind, { title: item, status: str(args.status) || LIST_FLOW[l.kind].statuses[0], by: args.by, where: args.where, qty: args.qty, price: args.price, for: args.for, link: args.link, note: args.note, added: ctx.model.today });
    return { path: l.path, add: values, words: `Added ${item} to ${l.name}.` };
  }
  if (!there) throw new Error(`${item} isn’t on ${l.name}.`);
  const status = knownWord(LIST_FLOW[l.kind].statuses, args.status);
  const finished = stateOf(l.kind, status) === 'done' ? doneStatus(l.kind) : '';
  const values: Record<string, string> = { status: (LIST_FLOW[l.kind].statuses as string[]).includes(status) ? status : finished || status };
  if (typeof args.rating === 'number') values.rating = cleanItem(l.kind, { rating: args.rating }).rating;
  return { path: l.path, set: { row: there.row, title: there.title, values }, words: `${there.title} on ${l.name} is ${values.status.toLowerCase()} now${values.rating ? ` (${values.rating}/5)` : ''}.` };
}

/** list_create's new note, from its arguments. Throws in plain words an agent can pass on. */
export function planListCreate(args: Record<string, unknown>, ctx: { on: boolean; model: ListsModel }): { name: string; kind: ListKind; text: string; words: string } {
  if (!ctx.on) throw new Error(OFF);
  const name = str(args.name).slice(0, 100);
  if (!name) throw new Error('A list needs a name.');
  if (ctx.model.lists.some((l) => l.name.toLowerCase() === name.toLowerCase())) throw new Error(`There is already a list called ${name}.`);
  const kind = kindOf(args.kind);
  return { name, kind, text: newListText(kind, str(args.for).slice(0, 80), [], ctx.model.today), words: `Started the ${kind.toLowerCase()} list ${name}.` };
}

export { ITEMS as LIST_ITEMS_SPEC };
