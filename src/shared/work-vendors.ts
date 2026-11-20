// Vendors, Quotes and Contracts (Wave 6 part b, 24 Oct 2026; module 6 of the catalogue: "Quotes, POs, contracts,
// validity, amounts · Expiry alerts, compare quotes, link to project · Work-confidential"). Every record is a plain note
// the person owns, of the module's own types (src/shared/work-modules.ts VENDORS), Work-confidential by its type:
//
//   Work/Vendors and Contracts/Vendors/Northwind Builders.md           category, contact, email, phone, website, status
//   Work/Vendors and Contracts/Quotes/Northwind Builders quote.md      vendor, project, amount, currency, received,
//                                                                valid_until, status, reference, version; ## Items table
//   Work/Vendors and Contracts/Purchase orders/PO 4501.md        vendor, project, quote, number, amount, raised, delivery,
//                                                                status
//   Work/Vendors and Contracts/Contracts/Bluegum Telco contract.md  vendor, project, amount, period, starts, ends,
//                                                                notice_days, renewal, status, reference; its files beside it
//
// Here: each record read (hand-edited notes forgiven), what a quote's validity and a contract's notice and end mean today
// (an auto-renewing contract rolls on by its period), what needs the person, quotes side by side item by item, the
// records for the vault's views, one property or one item's cell changed, new notes, and the agents' tools with their
// answers. Never a guessed amount or day. Pure: no files, no Node, no DOM.

import { addDays, daysFrom, dueWords, isoOf, moneyWords, readIsoDay, readMoney, safeFileName, whenWords } from './finance';
import { readTable, setTableCells, removeTableRow, addTableRow } from './layouts';
import { linkName, str, yamlWords } from './work-text';

export { linkName };
import { resolveOne } from './record-match';
import { defaultRecordView, type RecordViewDef } from './record-views';
import { setNoteProp } from './views';
import { CONTRACT_PERIODS, CONTRACT_RENEWALS, CONTRACT_STATUSES, PO_STATUSES, QUOTE_STATUSES, VENDOR_CATEGORIES, VENDOR_STATUSES } from './work-modules';
import { plural } from './words';
import type { WorkToolDef } from './work-module-tools';
import type { WsRecord } from './workspace-records';

export interface VendorNote {
  path: string;
  title: string;
  props: Record<string, unknown>;
  content: string;
  /** vendor, quote, purchase-order or contract. */
  type: string;
  /** Files kept beside it (paths in the vault), newest first. */
  files?: string[];
}

export type QuoteState = 'Valid' | 'Lapses soon' | 'Lapsed' | 'Requested' | 'Accepted' | 'Declined' | 'Superseded';
export type ContractState = 'Draft' | 'Active' | 'Notice period soon' | 'In notice period' | 'Ending' | 'Ended';

export interface Vendor {
  path: string;
  name: string;
  category: string;
  contact: string;
  email: string;
  phone: string;
  website: string;
  status: string;
  quotes: number;
  openQuotes: number;
  /** Open quotes added up across currencies (a number for sorting and filtering only: display reads openValueWords). */
  openValue: number;
  /** Open quotes' worth in words, per currency ("$5,800", "AUD 5,800 + USD 500"). */
  openValueWords: string;
  acceptedValue: number;
  acceptedValueWords: string;
  orders: number;
  openOrders: number;
  ordersValue: number;
  contracts: number;
  activeContracts: number;
  files: string[];
}

export interface QuoteItem {
  /** Its row in the Items table (0 is the first row under the header). */
  row: number;
  item: string;
  qty: number | null;
  unit: number | null;
  /** Its total as written, else qty × unit. */
  total: number | null;
}

export interface Quote {
  path: string;
  name: string;
  vendor: string;
  vendorPath: string | null;
  project: string;
  projectPath: string | null;
  amount: number | null;
  currency: string;
  received: string | null;
  validUntil: string | null;
  /** As written (Requested, Received, Accepted…). */
  status: string;
  state: QuoteState;
  /** Days until it lapses (negative: since it lapsed), when it has a day. */
  days: number | null;
  reference: string;
  version: string;
  items: QuoteItem[];
  /** The Items table's column for each part (-1: not there). */
  cols: { item: number; qty: number; unit: number; total: number };
  itemsTotal: number | null;
  /** Waiting on a decision (valid, lapsing soon or requested). */
  open: boolean;
  files: string[];
}

export interface PurchaseOrder {
  path: string;
  name: string;
  vendor: string;
  vendorPath: string | null;
  project: string;
  projectPath: string | null;
  quote: string;
  quotePath: string | null;
  number: string;
  amount: number | null;
  raised: string | null;
  delivery: string | null;
  status: string;
  /** Its delivery day has passed and it isn't delivered yet. */
  late: boolean;
  /** Not paid or cancelled yet. */
  open: boolean;
  /** Files kept beside it (its page of its own, 30 Oct 2026). */
  files: string[];
}

export interface Contract {
  path: string;
  name: string;
  vendor: string;
  vendorPath: string | null;
  project: string;
  projectPath: string | null;
  amount: number | null;
  period: string;
  starts: string | null;
  /** The end it is heading for now (an auto-renewing contract past its written end rolled on by its period). */
  ends: string | null;
  endsWritten: string | null;
  rolled: boolean;
  noticeDays: number | null;
  /** The last day to give notice (its end less its notice days). */
  noticeBy: string | null;
  renewal: string;
  status: string;
  state: ContractState;
  /** Days to its end and to its notice day. */
  days: number | null;
  noticeIn: number | null;
  reference: string;
  files: string[];
}

export interface Attention {
  kind: 'quote' | 'contract' | 'order';
  path: string;
  /** What it is, in a line ("Northwind Builders’ quote lapses in 5 days"). */
  words: string;
  sub: string;
  tone: 'bad' | 'warn';
  /** Its one action: give the quote a new day, mark it lapsed, mark an order delivered, or open it. */
  action: 'extend' | 'lapse' | 'delivered' | 'open';
  /** For notices: a stable key (said once). */
  key: string;
  project: string;
}

export interface VendorsModel {
  vendors: Vendor[];
  quotes: Quote[];
  orders: PurchaseOrder[];
  contracts: Contract[];
  attention: Attention[];
  today: string;
  remindDays: number;
}

// ── Reading ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A project's words as its name ("Harbour Fit-out", "harbour"): resolved first, so a typo is refused with the
 * projects there instead of filed as a link to nowhere. Empty stays empty (no project named). */
export function resolveVendorProject(projects: readonly { name: string; path: string }[], words: unknown): string {
  const s = linkName(words);
  if (!s) return '';
  return resolveOne(projects.map((p) => ({ name: p.name, path: p.path })), s, { noun: 'project', candidates: projects.map((p) => p.name) }).name;
}

const lower = (s: string) => s.trim().toLowerCase();
const oneOf = <T extends string>(list: readonly T[], v: unknown, fallback: T): T => list.find((x) => lower(x) === lower(str(v))) ?? fallback;
/** One of a list's words whatever its case, for reading notes: empty reads as the fallback, but a mistyped value reads
 *  as written, so the person sees their typo instead of a silently substituted status. New notes keep oneOf. */
const readOneOf = (list: readonly string[], v: unknown, fallback: string): string => list.find((x) => lower(x) === lower(str(v))) ?? (str(v) ? str(v) : fallback);
// One plural rule everywhere (3 Nov 2026, fourth-round G5-G7): imported from ./words above.
const nameOf = (path: string) => path.split('/').pop()!.replace(/\.md$/i, '');

/** The body of a "## Heading" section (the lines under it, to the next ## or the end), with where it sits. */
export function sectionOf(text: string, heading: RegExp): { start: number; end: number; body: string } | null {
  const lines = String(text ?? '').split('\n');
  const at = lines.findIndex((l) => /^##\s+/.test(l) && heading.test(l.replace(/^##\s+/, '').replace(/\r$/, '').trim()));
  if (at < 0) return null;
  let end = at + 1;
  while (end < lines.length && !/^#{1,2}\s+/.test(lines[end])) end++;
  const before = lines.slice(0, at + 1).join('\n').length + 1;
  const body = lines.slice(at + 1, end).join('\n');
  return { start: before, end: before + body.length, body };
}
const ITEMS = /^items?$|^quote items?$|^line items$|^pricing$|^breakdown$/i;

function readItems(content: string): { items: QuoteItem[]; cols: Quote['cols'] } {
  const sec = sectionOf(content, ITEMS);
  const t = sec ? readTable(sec.body) : null;
  const none = { item: -1, qty: -1, unit: -1, total: -1 };
  if (!t || !t.head.length) return { items: [], cols: none };
  const find = (re: RegExp) => t.head.findIndex((h) => re.test(h.trim()));
  const cols = { item: find(/^(item|description|what|product|service)s?$/i), qty: find(/^(qty|quantity|units?|no\.?|count)$/i), unit: find(/^(unit( price| cost)?|price|rate|each|ex gst)$/i), total: find(/^(total|amount|line total|subtotal|cost)$/i) };
  const items: QuoteItem[] = t.rows.map((r, row) => {
    const qty = cols.qty >= 0 ? readNumber(r[cols.qty]) : null;
    const unit = cols.unit >= 0 ? readMoney(r[cols.unit]) : null;
    const written = cols.total >= 0 ? readMoney(r[cols.total]) : null;
    const total = written ?? (qty !== null && unit !== null ? Math.round(qty * unit * 100) / 100 : null);
    return { row, item: (r[cols.item] ?? '').trim(), qty, unit, total };
  });
  return { items, cols };
}
const readNumber = (v: unknown): number | null => {
  const s = str(v).replace(/[,\s]/g, '');
  if (!s || !/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
};

function addMonths(iso: string, n: number): string {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7)) - 1;
  const d = Number(iso.slice(8, 10));
  const last = new Date(y, m + n + 1, 0).getDate();
  return isoOf(new Date(y, m + n, Math.min(d, last)));
}
const PERIOD_MONTHS: Record<string, number> = { Monthly: 1, Quarterly: 3, Yearly: 12 };

export function readQuote(n: VendorNote, today: string, remind: number, currency = 'AUD'): Quote {
  const p = n.props;
  const status = readOneOf(QUOTE_STATUSES, p.status, 'Received');
  const validUntil = readIsoDay(p.valid_until ?? p.valid ?? p.expires);
  const days = validUntil ? daysFrom(today, validUntil) : null;
  let state: QuoteState;
  if (status === 'Accepted' || status === 'Declined' || status === 'Superseded' || status === 'Lapsed') state = status;
  else if (days !== null && days < 0) state = 'Lapsed';
  else if (days !== null && days <= remind) state = 'Lapses soon';
  else state = status === 'Requested' ? 'Requested' : 'Valid';
  const { items, cols } = readItems(n.content);
  const totals = items.map((i) => i.total).filter((x): x is number => x !== null);
  return {
    path: n.path,
    name: n.title,
    vendor: linkName(p.vendor),
    vendorPath: null,
    project: linkName(p.project),
    projectPath: null,
    amount: readMoney(p.amount),
    currency: /^[A-Z]{3}$/.test(str(p.currency).toUpperCase()) ? str(p.currency).toUpperCase() : currency,
    received: readIsoDay(p.received),
    validUntil,
    status,
    state,
    days,
    reference: str(p.reference),
    version: str(p.version),
    items,
    cols,
    itemsTotal: totals.length ? Math.round(totals.reduce((s, x) => s + x, 0) * 100) / 100 : null,
    open: state === 'Valid' || state === 'Lapses soon' || state === 'Requested',
    files: n.files ?? [],
  };
}

export function readOrder(n: VendorNote, today: string): PurchaseOrder {
  const p = n.props;
  const status = readOneOf(PO_STATUSES, p.status, 'Raised');
  const delivery = readIsoDay(p.delivery);
  const waiting = status === 'Draft' || status === 'Raised' || status === 'Approved';
  return {
    path: n.path,
    name: n.title,
    vendor: linkName(p.vendor),
    vendorPath: null,
    project: linkName(p.project),
    projectPath: null,
    quote: linkName(p.quote),
    quotePath: null,
    number: str(p.number),
    amount: readMoney(p.amount),
    raised: readIsoDay(p.raised),
    delivery,
    status,
    late: waiting && !!delivery && delivery < today,
    open: status !== 'Paid' && status !== 'Cancelled',
    files: n.files ?? [],
  };
}

export function readContract(n: VendorNote, today: string, remind: number): Contract {
  const p = n.props;
  const period = readOneOf(CONTRACT_PERIODS, p.period, 'Yearly');
  const renewal = readOneOf(CONTRACT_RENEWALS, p.renewal, 'Ends');
  const status = readOneOf(CONTRACT_STATUSES, p.status, 'Active');
  const endsWritten = readIsoDay(p.ends ?? p.end ?? p.expires);
  let ends = endsWritten;
  let rolled = false;
  // An auto-renewing contract past its written end has rolled on by its period, as many times as it took.
  if (ends && ends < today && renewal === 'Auto-renews' && PERIOD_MONTHS[period] && status !== 'Ended') {
    for (let k = 0; k < 600 && ends < today; k++) ends = addMonths(ends, PERIOD_MONTHS[period]);
    rolled = true;
  }
  const nd = readNumber(p.notice_days ?? p.notice);
  const noticeDays = nd !== null && nd >= 0 ? Math.round(nd) : null;
  const noticeBy = ends && noticeDays ? addDays(ends, -noticeDays) : null;
  const days = ends ? daysFrom(today, ends) : null;
  const noticeIn = noticeBy ? daysFrom(today, noticeBy) : null;
  let state: ContractState;
  if (status === 'Draft') state = 'Draft';
  else if (status === 'Ended' || (days !== null && days < 0)) state = 'Ended';
  else if (renewal === 'Ends' && days !== null && days <= remind) state = 'Ending';
  else if (noticeIn !== null && noticeIn < 0) state = 'In notice period';
  else if (noticeIn !== null && noticeIn <= remind) state = 'Notice period soon';
  else if (days !== null && days <= remind) state = 'Ending';
  else state = 'Active';
  return { path: n.path, name: n.title, vendor: linkName(p.vendor), vendorPath: null, project: linkName(p.project), projectPath: null, amount: readMoney(p.amount), period, starts: readIsoDay(p.starts ?? p.start), ends, endsWritten, rolled, noticeDays, noticeBy, renewal, status, state, days, noticeIn, reference: str(p.reference), files: n.files ?? [] };
}

/**
 * The whole module from its notes: each vendor with what is open with them, every quote's validity, every order and
 * contract, and what needs the person (soonest and worst first). `projects` turn a project's name into its file.
 */
export function vendorsModel(notes: readonly VendorNote[], today: Date | string = new Date(), remindDays = 30, opts: { currency?: string; projects?: readonly { path: string; name: string }[] } = {}): VendorsModel {
  const t = typeof today === 'string' ? today : isoOf(today);
  const currency = opts.currency ?? 'AUD';
  const vendorNotes = notes.filter((n) => n.type === 'vendor');
  const quotes = notes.filter((n) => n.type === 'quote').map((n) => readQuote(n, t, remindDays, currency));
  const orders = notes.filter((n) => n.type === 'purchase-order').map((n) => readOrder(n, t));
  const contracts = notes.filter((n) => n.type === 'contract').map((n) => readContract(n, t, remindDays));
  const vendorPath = new Map(vendorNotes.map((n) => [lower(n.title), n.path]));
  const projectPath = (name: string) => (name ? (opts.projects?.find((p) => lower(p.name) === lower(name) || lower(nameOf(p.path)) === lower(name))?.path ?? null) : null);
  const quotePath = new Map(quotes.map((q) => [lower(q.name), q.path]));
  for (const x of [...quotes, ...orders, ...contracts]) {
    x.vendorPath = vendorPath.get(lower(x.vendor)) ?? null;
    x.projectPath = projectPath(x.project);
  }
  for (const o of orders) o.quotePath = o.quote ? (quotePath.get(lower(o.quote)) ?? null) : null;
  // A vendor named only on a quote, order or contract still shows (with no note of its own yet).
  const names = new Map<string, { path: string; name: string; props: Record<string, unknown>; files: string[] }>();
  for (const n of vendorNotes) names.set(lower(n.title), { path: n.path, name: n.title, props: n.props, files: n.files ?? [] });
  for (const x of [...quotes, ...orders, ...contracts]) if (x.vendor && !names.has(lower(x.vendor))) names.set(lower(x.vendor), { path: '', name: x.vendor, props: {}, files: [] });
  const vendors: Vendor[] = [...names.values()].map((v) => {
    const mine = <T extends { vendor: string }>(list: T[]) => list.filter((x) => lower(x.vendor) === lower(v.name));
    const q = mine(quotes);
    const o = mine(orders);
    const c = mine(contracts);
    const sum = (list: (number | null)[]) => Math.round(list.reduce<number>((s, x) => s + (x ?? 0), 0) * 100) / 100;
    // Quotes' worth in words, per currency: one currency reads plain ("$5,800"), more than one is never mushed to
    // one figure ("AUD 5,800 + USD 500"), and none reads zero in the model's own currency.
    const valueWords = (list: Quote[]) => {
      const by = new Map<string, number>();
      for (const x of list) if (x.amount !== null) by.set(x.currency, Math.round(((by.get(x.currency) ?? 0) + x.amount) * 100) / 100);
      const groups = [...by.entries()].sort((a, b) => (a[0] === currency ? -1 : b[0] === currency ? 1 : a[0].localeCompare(b[0])));
      if (!groups.length) return moneyWords(0, currency);
      if (groups.length === 1 && groups[0][0] === currency) return moneyWords(groups[0][1], currency);
      const num = (n: number) => moneyWords(n, 'AUD').replace(/^−?\$/, (w) => (w.startsWith('−') ? '−' : ''));
      return groups.map(([code, value]) => `${code} ${num(value)}`).join(' + ');
    };
    const open = q.filter((x) => x.open);
    const accepted = q.filter((x) => x.state === 'Accepted');
    return {
      path: v.path,
      name: v.name,
      category: readOneOf(VENDOR_CATEGORIES, v.props.category, 'Other'),
      contact: linkName(v.props.contact),
      email: str(v.props.email),
      phone: str(v.props.phone),
      website: str(v.props.website),
      status: readOneOf(VENDOR_STATUSES, v.props.status, 'Active'),
      quotes: q.length,
      openQuotes: open.length,
      openValue: sum(open.map((x) => x.amount)),
      openValueWords: valueWords(open),
      acceptedValue: sum(accepted.map((x) => x.amount)),
      acceptedValueWords: valueWords(accepted),
      orders: o.length,
      openOrders: o.filter((x) => x.open).length,
      ordersValue: sum(o.filter((x) => x.status !== 'Cancelled').map((x) => x.amount)),
      contracts: c.length,
      activeContracts: c.filter((x) => x.state !== 'Ended' && x.state !== 'Draft').length,
      files: v.files,
    };
  });
  vendors.sort((a, b) => a.name.localeCompare(b.name));
  quotes.sort((a, b) => Number(b.open) - Number(a.open) || (a.validUntil ?? '9999').localeCompare(b.validUntil ?? '9999') || a.name.localeCompare(b.name));
  orders.sort((a, b) => (b.raised ?? '').localeCompare(a.raised ?? '') || a.name.localeCompare(b.name));
  contracts.sort((a, b) => (a.ends ?? '9999').localeCompare(b.ends ?? '9999') || a.name.localeCompare(b.name));
  return { vendors, quotes, orders, contracts, attention: attentionOf(quotes, orders, contracts, t, remindDays), today: t, remindDays };
}

const whose = (vendor: string, what: string) => (vendor ? `${vendor}${/s$/i.test(vendor) ? '’' : '’s'} ${what}` : `A ${what}`);

function attentionOf(quotes: Quote[], orders: PurchaseOrder[], contracts: Contract[], today: string, remind: number): Attention[] {
  const out: (Attention & { sort: number })[] = [];
  for (const q of quotes) {
    if (q.days === null || !q.validUntil) continue;
    const label = whose(q.vendor, 'quote');
    const sub = [q.project, q.amount !== null ? moneyWords(q.amount, q.currency) : ''].filter(Boolean).join(' · ');
    if (q.state === 'Lapsed' && (q.status === 'Received' || q.status === 'Requested'))
      out.push({ kind: 'quote', path: q.path, words: `${label} lapsed ${q.days === -1 ? 'yesterday' : `on ${dueWords(q.validUntil, today)}`}`, sub: sub || q.name, tone: 'bad', action: 'extend', key: `quote:${q.path}:${q.validUntil}:lapsed`, project: q.project, sort: q.days });
    else if (q.state === 'Lapses soon') out.push({ kind: 'quote', path: q.path, words: `${label} lapses ${whenWords(q.days)}`, sub: [sub || q.name, dueWords(q.validUntil, today)].join(' · '), tone: q.days <= 3 ? 'bad' : 'warn', action: 'extend', key: `quote:${q.path}:${q.validUntil}:soon`, project: q.project, sort: q.days });
  }
  for (const c of contracts) {
    if (c.state === 'Ended' || c.state === 'Draft' || !c.ends || c.days === null) continue;
    const label = whose(c.vendor, 'contract');
    if (c.state === 'Notice period soon' && c.noticeBy && c.noticeIn !== null)
      out.push({ kind: 'contract', path: c.path, words: `Give notice on ${label.replace(/^A /, 'a ')} ${c.noticeIn === 0 ? 'today' : `by ${dueWords(c.noticeBy, today)}`}`, sub: `${c.renewal === 'Auto-renews' ? 'Renews by itself' : 'Ends'} ${dueWords(c.ends, today)}${c.noticeDays ? ` · ${c.noticeDays} days’ notice` : ''}`, tone: c.noticeIn <= 7 ? 'bad' : 'warn', action: 'open', key: `contract:${c.path}:${c.noticeBy}:notice`, project: c.project, sort: c.noticeIn });
    else if (c.state === 'In notice period' && c.renewal === 'Auto-renews' && c.days <= remind)
      // One plain line (packs uplift item 15): "renews on X; too late to give notice", with the notice day kept as
      // the receipt underneath.
      out.push({ kind: 'contract', path: c.path, words: `${label} renews on ${dueWords(c.ends, today)}; too late to give notice`, sub: [c.project, c.noticeBy ? `notice was due ${dueWords(c.noticeBy, today)}` : ''].filter(Boolean).join(' · '), tone: 'warn', action: 'open', key: `contract:${c.path}:${c.ends}:renews`, project: c.project, sort: c.days });
    else if (c.state === 'Ending' || (c.state === 'In notice period' && c.days <= remind))
      out.push({ kind: 'contract', path: c.path, words: `${label} ends ${whenWords(c.days)}`, sub: [dueWords(c.ends, today), c.renewal === 'Option to renew' ? 'option to renew' : ''].filter(Boolean).join(' · '), tone: c.days <= 7 ? 'bad' : 'warn', action: 'open', key: `contract:${c.path}:${c.ends}:end`, project: c.project, sort: c.days });
  }
  for (const o of orders)
    if (o.late && o.delivery) out.push({ kind: 'order', path: o.path, words: `${o.number ? `PO ${o.number}` : o.name}${o.vendor ? ` from ${o.vendor}` : ''} was due ${dueWords(o.delivery, today)}`, sub: [o.project, o.amount !== null ? moneyWords(o.amount) : '', o.status].filter(Boolean).join(' · '), tone: 'warn', action: 'delivered', key: `po:${o.path}:${o.delivery}:late`, project: o.project, sort: daysFrom(today, o.delivery) });
  return out.sort((a, b) => Number(a.tone !== 'bad') - Number(b.tone !== 'bad') || a.sort - b.sort).map(({ sort: _s, ...x }) => x);
}

// ── Comparing quotes ─────────────────────────────────────────────────────────────────────────────────────────────────

const STOP = new Set(['the', 'a', 'an', 'and', 'of', 'for', 'with', 'x', 'incl', 'including', 'supply', 'install', 'to', 'in', 'on']);
const words = (s: string) =>
  lower(s)
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w))
    .map((w) => (w.length > 3 ? w.replace(/(?<!s)s$/, '') : w));
function alike(a: string, b: string): number {
  const x = new Set(words(a));
  const y = new Set(words(b));
  if (!x.size || !y.size) return 0;
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  return both / new Set([...x, ...y]).size;
}

export interface Comparison {
  /** The quotes, lowest amount first (those without an amount last). */
  quotes: Quote[];
  /** The lowest amount's quote (none when fewer than two have amounts). */
  cheapest: string | null;
  /** How much more each costs than the lowest. */
  over: Record<string, number>;
  /** Items lined up across the quotes by their words: each row's item in each quote (null: that quote doesn't list it). */
  rows: { item: string; cells: (QuoteItem | null)[] }[];
  /** All in one currency (amounts in different currencies aren't ranked). */
  sameCurrency: boolean;
}

export function compareQuotes(list: readonly Quote[]): Comparison {
  const quotes = [...list].sort((a, b) => (a.amount ?? Infinity) - (b.amount ?? Infinity) || a.vendor.localeCompare(b.vendor));
  const sameCurrency = new Set(quotes.map((q) => q.currency)).size <= 1;
  const priced = quotes.filter((q) => q.amount !== null);
  const cheapest = sameCurrency && priced.length >= 2 ? priced[0].path : null;
  const over: Record<string, number> = {};
  if (cheapest) for (const q of priced) over[q.path] = Math.round((q.amount! - priced[0].amount!) * 100) / 100;
  const rows: Comparison['rows'] = [];
  quotes.forEach((q, qi) => {
    for (const it of q.items) {
      if (!it.item) continue;
      let best = -1;
      let score = 0;
      rows.forEach((r, ri) => {
        if (r.cells[qi]) return;
        const s = lower(r.item) === lower(it.item) ? 1 : alike(r.item, it.item);
        if (s > score) {
          score = s;
          best = ri;
        }
      });
      if (best >= 0 && score >= 0.5) rows[best].cells[qi] = it;
      else {
        const cells: (QuoteItem | null)[] = quotes.map(() => null);
        cells[qi] = it;
        rows.push({ item: it.item, cells });
      }
    }
  });
  return { quotes, cheapest, over, rows, sameCurrency };
}

// ── Records for the views ────────────────────────────────────────────────────────────────────────────────────────────

export function vendorRecords(m: VendorsModel): WsRecord[] {
  const out: WsRecord[] = [];
  for (const v of m.vendors)
    out.push({ id: `${v.path || `vendor:${v.name}`}::vendor`, kind: 'vendor', title: v.name, ...(v.path ? { path: v.path } : {}), fields: { category: v.category, contact: v.contact || null, email: v.email || null, phone: v.phone || null, website: v.website || null, status: v.status, quotes: v.quotes, open_value: v.openValue, orders: v.orders, contracts: v.contracts }, links: [] });
  for (const q of m.quotes)
    out.push({ id: `${q.path}::quote`, kind: 'quote', title: q.name, path: q.path, ...(q.project ? { projectName: q.project } : {}), ...(q.projectPath ? { project: q.projectPath } : {}), fields: { vendor: q.vendor || null, amount: q.amount, received: q.received, valid_until: q.validUntil, days_left: q.days, status: q.state, reference: q.reference || null, version: q.version || null, items: q.items.length || null }, links: [] });
  for (const o of m.orders)
    out.push({ id: `${o.path}::order`, kind: 'order', title: o.name, path: o.path, ...(o.project ? { projectName: o.project } : {}), ...(o.projectPath ? { project: o.projectPath } : {}), fields: { vendor: o.vendor || null, po_number: o.number || null, amount: o.amount, raised: o.raised, delivery: o.delivery, status: o.late ? 'Late' : o.status }, links: [] });
  for (const c of m.contracts)
    out.push({ id: `${c.path}::contract`, kind: 'contract', title: c.name, path: c.path, ...(c.project ? { projectName: c.project } : {}), ...(c.projectPath ? { project: c.projectPath } : {}), fields: { vendor: c.vendor || null, amount: c.amount, period: c.period, starts: c.starts, ends: c.ends, notice_by: c.noticeBy, renewal: c.renewal, status: c.state, reference: c.reference || null }, links: [] });
  return out;
}

/** The fields of each kind that can be changed where they show (each is one property of its note). */
export const VENDOR_EDITABLE: Record<string, string[]> = {
  vendor: ['category', 'contact', 'email', 'phone', 'website', 'status'],
  quote: ['vendor', 'project', 'amount', 'received', 'valid_until', 'status', 'reference', 'version'],
  order: ['vendor', 'project', 'po_number', 'amount', 'raised', 'delivery', 'status'],
  contract: ['vendor', 'project', 'amount', 'period', 'starts', 'ends', 'notice_by', 'renewal', 'status', 'reference'],
};

/** Each page's views as first made (the person's changes are kept in the vault's module options). */
export function vendorSectionViews(section: string): RecordViewDef[] {
  const v = (kinds: WsRecord['kind'][], layout: RecordViewDef['layout'], title: string, patch: Partial<RecordViewDef> = {}): RecordViewDef => ({ ...defaultRecordView(kinds, layout, title), scope: 'vault', showDone: true, ...patch });
  switch (section) {
    case 'vendors':
      return [v(['vendor'], 'table', 'Vendors', { fields: ['category', 'contact', 'status', 'quotes', 'open_value', 'orders', 'contracts'], sort: { field: 'title', dir: 'asc' } })];
    case 'quotes':
      return [v(['quote'], 'table', 'Quotes', { fields: ['vendor', 'project', 'amount', 'valid_until', 'status', 'reference'], sort: { field: 'valid_until', dir: 'asc' } }), v(['quote'], 'board', 'By where each stands', { groupBy: 'status', fields: ['vendor', 'amount', 'valid_until'] })];
    case 'orders':
      return [v(['order'], 'table', 'Purchase orders', { fields: ['vendor', 'po_number', 'project', 'amount', 'raised', 'delivery', 'status'], sort: { field: 'raised', dir: 'desc' } })];
    case 'contracts':
      return [v(['contract'], 'table', 'Contracts', { fields: ['vendor', 'amount', 'period', 'ends', 'notice_by', 'renewal', 'status'], sort: { field: 'ends', dir: 'asc' } }), v(['contract'], 'timeline', 'From start to end', { dateField: 'starts', endField: 'ends', fields: ['vendor'] })];
  }
  return [];
}

// ── Changing a record ────────────────────────────────────────────────────────────────────────────────────────────────

const link = (v: unknown) => {
  const s = linkName(v);
  return s ? `[[${s}]]` : null;
};

/**
 * One value of a record changed where it shows: its note with that one property set (an amount as a number, a day as
 * YYYY-MM-DD, a vendor, contact or project as a link), and words to say when there is more to it. Throws in plain words.
 */
export function editVendorRecord(text: string, kind: string, field: string, value: unknown, today: string): { text: string; words: string | null } {
  if (!VENDOR_EDITABLE[kind]?.includes(field)) throw new Error('That can’t be changed here.');
  const blank = value === null || value === undefined || String(value).trim() === '';
  const day = () => {
    if (blank) return null;
    const d = readIsoDay(value);
    if (!d) throw new Error('Give a day, like 14 Nov 2026.');
    return d;
  };
  const money = () => {
    if (blank) return null;
    const n = readMoney(value);
    if (n === null) throw new Error('Give an amount, like 12,400 or 12400.50.');
    return n;
  };
  const choice = (list: readonly string[], map: Record<string, string> = {}) => {
    const v = str(value);
    const mapped = map[lower(v)] ?? v;
    const hit = list.find((x) => lower(x) === lower(mapped));
    if (!hit) throw new Error(`Choose one of: ${list.join(', ')}.`);
    return hit;
  };
  switch (field) {
    case 'vendor':
    case 'contact':
    case 'project':
      return { text: setNoteProp(text, field, link(value)), words: null };
    case 'amount':
      return { text: setNoteProp(text, 'amount', money()), words: null };
    case 'received':
    case 'valid_until':
    case 'raised':
    case 'delivery':
    case 'starts':
    case 'ends':
      return { text: setNoteProp(text, field, day()), words: null };
    case 'notice_by': {
      // The last day to give notice is worked out from the end: setting it sets the notice days.
      const d = day();
      if (!d) return { text: setNoteProp(text, 'notice_days', null), words: null };
      const m = /^ends:\s*["']?(\d{4}-\d{2}-\d{2})/m.exec(text);
      if (!m) throw new Error('Give the contract its end day first; the day to give notice is counted back from it.');
      const n = daysFrom(d, m[1]);
      if (n < 0) throw new Error('The day to give notice has to be before the contract ends.');
      return { text: setNoteProp(text, 'notice_days', n), words: `Notice is ${plural(n, 'day')} before it ends.` };
    }
    case 'po_number':
      return { text: setNoteProp(text, 'number', str(value).slice(0, 60) || null), words: null };
    case 'category':
      return { text: setNoteProp(text, 'category', choice(VENDOR_CATEGORIES)), words: null };
    case 'period':
      return { text: setNoteProp(text, 'period', choice(CONTRACT_PERIODS)), words: null };
    case 'renewal':
      return { text: setNoteProp(text, 'renewal', choice(CONTRACT_RENEWALS)), words: null };
    case 'status': {
      if (kind === 'vendor') return { text: setNoteProp(text, 'status', choice(VENDOR_STATUSES)), words: null };
      if (kind === 'order') return { text: setNoteProp(text, 'status', choice(PO_STATUSES, { late: 'raised' })), words: null };
      if (kind === 'contract') return { text: setNoteProp(text, 'status', choice(CONTRACT_STATUSES, { 'notice period soon': 'active', 'in notice period': 'active', ending: 'active' })), words: null };
      // A quote's board shows where it stands (Valid, Lapses soon); dropping one there means it is still on the table.
      const s = choice(QUOTE_STATUSES, { valid: 'received', 'lapses soon': 'received' });
      const valid = /^valid_until:\s*["']?(\d{4}-\d{2}-\d{2})/m.exec(text)?.[1];
      const said = (s === 'Received' || s === 'Requested') && valid && valid < today ? `It still reads as lapsed: its valid-until day (${dueWords(valid, today)}) has passed. Give it a new day if the vendor extended it.` : null;
      return { text: setNoteProp(text, 'status', s), words: said };
    }
    default:
      return { text: setNoteProp(text, field, str(value).slice(0, 200) || null), words: null };
  }
}

/** A quote's Items section changed with `fn` (made, with its table, when it has none). */
function withItems(text: string, fn: (body: string) => string): string {
  const sec = sectionOf(text, ITEMS);
  if (!sec) {
    const body = fn('');
    const notes = /^##\s+Notes\s*$/im.exec(text);
    const block = `## Items\n\n${body.replace(/^\n+|\s+$/g, '')}\n\n`;
    return notes ? text.slice(0, notes.index) + block + text.slice(notes.index) : `${text.replace(/\s*$/, '')}\n\n${block}`;
  }
  return text.slice(0, sec.start) + fn(sec.body) + text.slice(sec.end);
}
const ITEM_HEAD = ['Item', 'Qty', 'Unit price', 'Total'];
const num2 = (n: number | null) => (n === null ? '' : Number.isInteger(n) ? String(n) : n.toFixed(2));

export interface ItemInput {
  item?: string;
  qty?: unknown;
  unit?: unknown;
  total?: unknown;
}

/** One cell of a quote's item changed (part: item, qty, unit or total); a qty or unit price changed works its total out. */
export function setQuoteItem(text: string, row: number, part: 'item' | 'qty' | 'unit' | 'total', value: unknown): string {
  const before = readItems(text);
  const it = before.items.find((i) => i.row === row);
  if (!it) throw new Error('That item isn’t there any more.');
  const cols = before.cols;
  const cells: Record<number, string> = {};
  const blank = value === null || value === undefined || String(value).trim() === '';
  if (part === 'item') {
    if (blank) throw new Error('An item needs words. Take it off with its ×, or give it a name.');
    if (cols.item < 0) throw new Error('This quote’s items have no Item column.');
    cells[cols.item] = str(value).slice(0, 200);
  } else {
    const n = blank ? null : part === 'qty' ? readNumber(value) : readMoney(value);
    if (!blank && n === null) throw new Error(part === 'qty' ? 'Give a quantity, like 4.' : 'Give an amount, like 1,250.');
    if (cols[part] < 0) throw new Error(`This quote’s items have no ${part === 'qty' ? 'Qty' : part === 'unit' ? 'Unit price' : 'Total'} column.`);
    cells[cols[part]] = num2(n);
    if ((part === 'qty' || part === 'unit') && cols.total >= 0) {
      const qty = part === 'qty' ? n : it.qty;
      const unit = part === 'unit' ? n : it.unit;
      cells[cols.total] = qty !== null && unit !== null ? num2(Math.round(qty * unit * 100) / 100) : '';
    }
  }
  return withItems(text, (body) => setTableCells(body, row, cells));
}

export function addQuoteItem(text: string, input: ItemInput): string {
  const item = str(input.item);
  if (!item) throw new Error('An item needs words.');
  const qty = str(input.qty) ? readNumber(input.qty) : null;
  const unit = str(input.unit) ? readMoney(input.unit) : null;
  if (str(input.qty) && qty === null) throw new Error('Give a quantity, like 4.');
  if (str(input.unit) && unit === null) throw new Error('Give a unit price, like 1,250.');
  const totalIn = str(input.total) ? readMoney(input.total) : null;
  const total = totalIn ?? (qty !== null && unit !== null ? Math.round(qty * unit * 100) / 100 : null);
  return withItems(text, (body) => {
    const t = readTable(body);
    const head = t && t.head.length ? t.head : ITEM_HEAD;
    const out = addTableRow(body, head, { Item: item, Qty: num2(qty), 'Unit price': num2(unit), Total: num2(total), Quantity: num2(qty), Price: num2(unit), Amount: num2(total), Description: item });
    return out.endsWith('\n') ? out : `${out}\n`;
  });
}

export function removeQuoteItem(text: string, row: number): string {
  if (!readItems(text).items.some((i) => i.row === row)) throw new Error('That item isn’t there any more.');
  return withItems(text, (body) => removeTableRow(body, row));
}

/** After items change: the quote's amount follows them when it was empty or was their old total. */
export function amountAfterItems(before: string, after: string): number | null {
  const was = readQuote({ path: '', title: '', props: propsOf(before), content: before, type: 'quote' }, '2000-01-01', 0);
  const now = readItems(after);
  const totals = now.items.map((i) => i.total).filter((x): x is number => x !== null);
  const total = totals.length ? Math.round(totals.reduce((s, x) => s + x, 0) * 100) / 100 : null;
  if (total === null || total === was.amount) return null;
  return was.amount === null || was.amount === was.itemsTotal ? total : null;
}
/** The few properties the item rules need, read plainly (no YAML library: this runs anywhere). */
function propsOf(text: string): Record<string, unknown> {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const out: Record<string, unknown> = {};
  if (!fm) return out;
  for (const l of fm[1].split(/\r?\n/)) {
    const m = /^([a-z_]+):\s*(.*)$/i.exec(l);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

// ── New notes ────────────────────────────────────────────────────────────────────────────────────────────────────────

const front = (lines: [string, string | number | null | undefined][]) => lines.map(([k, v]) => (v === null || v === undefined || v === '' ? `${k}:` : typeof v === 'number' || /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${k}: ${v}` : `${k}: ${/^\[\[/.test(v) ? JSON.stringify(v) : yamlWords(v)}`).replace(/:\s*$/, ':'));

export interface VendorInput {
  name: string;
  category?: string;
  contact?: string;
  email?: string;
  phone?: string;
  website?: string;
  status?: string;
}
export interface QuoteInput {
  vendor: string;
  project?: string;
  amount?: number | null;
  currency?: string;
  received?: string | null;
  validUntil?: string | null;
  status?: string;
  reference?: string;
  version?: string;
  items?: ItemInput[];
}
export interface OrderInput {
  vendor: string;
  project?: string;
  quote?: string;
  number?: string;
  amount?: number | null;
  raised?: string | null;
  delivery?: string | null;
  status?: string;
}
export interface ContractInput {
  vendor: string;
  project?: string;
  amount?: number | null;
  period?: string;
  starts?: string | null;
  ends?: string | null;
  noticeDays?: number | null;
  renewal?: string;
  status?: string;
  reference?: string;
}

const wiki = (s: string | undefined) => (str(s) ? `[[${linkName(s)}]]` : '');

export function newVendorText(v: VendorInput): string {
  return `---\n${front([['type', 'vendor'], ['category', oneOf(VENDOR_CATEGORIES, v.category, 'Other')], ['contact', wiki(v.contact)], ['email', str(v.email)], ['phone', str(v.phone)], ['website', str(v.website)], ['status', oneOf(VENDOR_STATUSES, v.status, 'Active')]]).join('\n')}\n---\n## Notes\n\n`;
}

export function newQuoteText(q: QuoteInput, today: string): string {
  const head = `---\n${front([['type', 'quote'], ['vendor', wiki(q.vendor)], ['project', wiki(q.project)], ['amount', q.amount ?? null], ['currency', str(q.currency).toUpperCase()], ['received', q.received ?? (oneOf(QUOTE_STATUSES, q.status, 'Received') === 'Requested' ? '' : today)], ['valid_until', q.validUntil ?? ''], ['status', oneOf(QUOTE_STATUSES, q.status, 'Received')], ['reference', str(q.reference)], ['version', str(q.version)]]).join('\n')}\n---\n`;
  let text = `${head}## Items\n\n| Item | Qty | Unit price | Total |\n| --- | --- | --- | --- |\n\n## Notes\n\n`;
  for (const it of q.items ?? []) if (str(it.item)) text = addQuoteItem(text, it);
  return text;
}

export function newOrderText(o: OrderInput, today: string): string {
  return `---\n${front([['type', 'purchase-order'], ['vendor', wiki(o.vendor)], ['project', wiki(o.project)], ['quote', wiki(o.quote)], ['number', str(o.number)], ['amount', o.amount ?? null], ['raised', o.raised ?? today], ['delivery', o.delivery ?? ''], ['status', oneOf(PO_STATUSES, o.status, 'Raised')]]).join('\n')}\n---\n## Notes\n\n`;
}

export function newContractText(c: ContractInput): string {
  return `---\n${front([['type', 'contract'], ['vendor', wiki(c.vendor)], ['project', wiki(c.project)], ['amount', c.amount ?? null], ['period', oneOf(CONTRACT_PERIODS, c.period, 'Yearly')], ['starts', c.starts ?? ''], ['ends', c.ends ?? ''], ['notice_days', c.noticeDays ?? null], ['renewal', oneOf(CONTRACT_RENEWALS, c.renewal, 'Ends')], ['status', oneOf(CONTRACT_STATUSES, c.status, 'Active')], ['reference', str(c.reference)]]).join('\n')}\n---\n## Files\n\n\n## Notes\n\n`;
}

/** Names for new notes: "Northwind Builders quote (Harbour Fit-out)", "PO 4501", "Bluegum Telco contract". */
export const quoteName = (q: Pick<QuoteInput, 'vendor' | 'project' | 'reference' | 'version'>) => safeFileName(`${linkName(q.vendor) || 'Vendor'} quote${q.reference ? ` ${str(q.reference)}` : q.project ? ` (${linkName(q.project)})` : ''}${q.version ? ` ${str(q.version)}` : ''}`);
export const orderName = (o: Pick<OrderInput, 'vendor' | 'number'>) => safeFileName(o.number ? `PO ${str(o.number)}` : `${linkName(o.vendor) || 'Vendor'} purchase order`);
export const contractName = (c: Pick<ContractInput, 'vendor' | 'reference'>) => safeFileName(`${linkName(c.vendor) || 'Vendor'} contract${c.reference ? ` ${str(c.reference)}` : ''}`);

const normVendor = (s: string) => lower(s).replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
const editDistance = (a: string, b: string): number => {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
};

/** The known vendor a name almost surely mistypes ("Northwnd Builders" → "Northwind Builders"), else null: an exact name and a
 *  genuinely new one ask nothing. Short names never suggest, so "AVX" stays its own vendor beside "AV". */
export function suggestVendorName(known: readonly string[], want: string): string | null {
  const w = normVendor(want);
  if (!w || known.some((k) => normVendor(k) === w)) return null;
  for (const k of known) {
    const n = normVendor(k);
    if (n && (n.includes(w) || w.includes(n)) && Math.min(n.length, w.length) >= 6) return k;
  }
  let best: string | null = null;
  let bestD = Infinity;
  for (const k of known) {
    const n = normVendor(k);
    if (!n) continue;
    const allow = Math.max(n.length, w.length) >= 8 ? 2 : Math.min(n.length, w.length) >= 4 ? 1 : 0;
    const d = editDistance(n, w);
    if (d > 0 && d <= allow && d < bestD) {
      bestD = d;
      best = k;
    }
  }
  return best;
}

/** A quote named by its name or its vendor: the one it surely means, or every candidate when more than one matches. */
export function resolveQuote(quotes: readonly Quote[], want: string, project?: string): { quote: Quote | null; candidates: Quote[] } {
  const w = lower(String(want ?? ''));
  if (!w) return { quote: null, candidates: [] };
  const exact = quotes.find((x) => lower(x.name) === w || lower(x.vendor) === w);
  if (exact) return { quote: exact, candidates: [] };
  const hits = quotes.filter((x) => lower(x.name).includes(w) || lower(x.vendor).includes(w)).filter((x) => !project || lower(x.project).includes(lower(project)));
  if (hits.length === 1) return { quote: hits[0], candidates: [] };
  return { quote: null, candidates: hits };
}

/** A quote read from a file's words (30 Oct 2026, "Make this a quote"): the amount (the total when one is named, else the largest amount), the day it is valid until, its reference and its priced lines. Only what the words plainly say is read; the person checks it once, and nothing here guesses. */
export function readQuoteFromText(text: string): { vendor: string; amount: number | null; currency: string; validUntil: string | null; received: string | null; reference: string; items: ItemInput[]; found: string[] } {
  const words = String(text ?? '');
  const found: string[] = [];
  const money = [...words.matchAll(/\$\s?(\d[\d,]*(?:\.\d{2})?)/g)].map((m) => readMoney(m[1])).filter((x): x is number => x !== null);
  const totalM = /(?:total|amount due|balance due)[^\d$]*\$\s?(\d[\d,]*(?:\.\d{2})?)/i.exec(words);
  // "Was $2,000, now $1,500" is $1,500: the price now beats the largest figure.
  const nowM = /(?:now|current price|sale)[^\d$]*\$\s?(\d[\d,]*(?:\.\d{2})?)/i.exec(words);
  const amount = totalM ? readMoney(totalM[1]) : nowM ? readMoney(nowM[1]) : money.length ? Math.max(...money) : null;
  if (amount !== null) found.push(`amount ${amount}`);
  const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const dayOf = (s: string): string | null => {
    const iso = readIsoDay(s);
    if (iso) return iso;
    const m = /(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?(?:,?\s+(\d{4}))?/.exec(s) ?? /([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?/.exec(s);
    if (!m) return null;
    const firstIsDay = /^\d/.test(m[1]);
    const month = months.findIndex((x) => x.startsWith((firstIsDay ? m[2] : m[1]).toLowerCase()));
    const day = Number(firstIsDay ? m[1] : m[2]);
    const year = Number(m[3] ?? new Date().getFullYear());
    if (month < 0 || !day || !year) return null;
    const d = new Date(year, month, day);
    return d.getMonth() === month ? isoOf(d) : null;
  };
  const validM = /(?:valid until|valid to|expires?|expiry)[^\d]*([^\n,;]+)/i.exec(words);
  const validUntil = validM ? dayOf(validM[1]) : null;
  if (validUntil) found.push(`valid until ${validUntil}`);
  // A reference is ref-shaped (a digit, or capitals): "Quote from Acme" reads no reference, never "from".
  const refM = /(?:quote(?! from|ation)|ref(?:erence)?|no\.?)\s*[:#]?\s*#?\s*([A-Za-z0-9][A-Za-z0-9-]{0,20})/i.exec(words);
  const reference = refM && /[0-9]|^[A-Z]{2,}/.test(refM[1]) ? refM[1] : '';
  if (reference) found.push(`reference ${reference}`);
  const fromM = /(?:from|quote from|prepared by)\s*:?\s*([A-Z][^\n,;]{2,60})/i.exec(words);
  const vendor = fromM ? fromM[1].trim() : '';
  if (vendor) found.push(`from ${vendor}`);
  const items: ItemInput[] = [];
  for (const line of words.split(/\r?\n/)) {
    const t = line.trim();
    const priced = /^[-*]?\s*(.+?)\s{2,}(\d+(?:\.\d+)?)\s*[x×]\s*\$\s?(\d[\d,]*(?:\.\d{2})?)/.exec(t) ?? /^\|\s*(.+?)\s*\|\s*(\d+(?:\.\d+)?)\s*\|\s*\$?\s?(\d[\d,]*(?:\.\d{2})?)\s*\|\s*\$?\s?(\d[\d,]*(?:\.\d{2})?)\s*\|/.exec(t);
    if (priced && !/^(item|description|total)\b/i.test(priced[1])) items.push({ item: priced[1].trim().slice(0, 200), qty: priced[2], unit: priced[3], ...(priced[4] ? { total: priced[4] } : {}) });
  }
  if (items.length) found.push(`${items.length} priced ${items.length === 1 ? 'line' : 'lines'}`);
  return { vendor, amount, currency: '', validUntil, received: null, reference, items: items.slice(0, 200), found };
}

// ── The agents' tools ────────────────────────────────────────────────────────────────────────────────────────────────

export const VENDOR_TOOLS: WorkToolDef[] = [
  {
    name: 'vendor_list',
    module: 'vendors',
    write: false,
    title: 'Suppliers',
    step: 'Looked through your vendors',
    description: 'Every vendor in the person’s Suppliers module (Ironleaf): category, contact, status, the value of their open quotes, their orders and contracts. Use it for "who are our suppliers?", "what do we have with <vendor>?".',
    parameters: { type: 'object', properties: { category: { type: 'string', description: 'Only this category (Hardware, Telco, AV…).' }, query: { type: 'string', description: 'Words in the vendor’s name.' } }, additionalProperties: false },
  },
  {
    name: 'quote_list',
    module: 'vendors',
    write: false,
    title: 'Quotes',
    step: 'Looked through your quotes',
    description: 'Quotes in the Suppliers module: vendor, project, amount, when each was received and is valid until, and where each stands (valid, lapses soon, lapsed, accepted, declined). Use it for "what quotes are open for <project>?", "has the <vendor> quote lapsed?".',
    parameters: { type: 'object', properties: { project: { type: 'string', description: 'Only quotes for this project.' }, vendor: { type: 'string', description: 'Only this vendor’s.' }, which: { type: 'string', enum: ['open', 'lapsing', 'all'], description: 'open (waiting on a decision, the default), lapsing (lapsed or lapsing soon) or all.' } }, additionalProperties: false },
  },
  {
    name: 'quote_compare',
    module: 'vendors',
    write: false,
    title: 'Compare quotes',
    step: 'Compared the quotes',
    description: 'Quotes side by side: amounts lowest first with how much more each costs, validity, status, and their items lined up by what they are. Give a project (its open and accepted quotes) or the quotes’ names.',
    parameters: { type: 'object', properties: { project: { type: 'string', description: 'Compare this project’s quotes.' }, quotes: { type: 'array', items: { type: 'string' }, description: 'The quotes’ names (as quote_list gives them).' } }, additionalProperties: false },
  },
  {
    name: 'quote_add',
    module: 'vendors',
    write: true,
    title: 'Add a quote',
    step: 'Added a quote to Suppliers',
    description: 'Add a quote to the Suppliers module: the vendor (made as a vendor too when new), and only what the person gave: amount, the day it is valid until, the project, its reference. Never guess an amount or a day; leave it out instead.',
    parameters: {
      type: 'object',
      properties: {
        vendor: { type: 'string', description: 'Who it is from.' },
        amount: { type: 'number' },
        currency: { type: 'string', description: 'Three letters (AUD, USD) when not the module’s own.' },
        valid_until: { type: 'string', description: 'YYYY-MM-DD' },
        received: { type: 'string', description: 'YYYY-MM-DD (today unless given).' },
        project: { type: 'string', description: 'The project it is for, by its name in Ironleaf.' },
        reference: { type: 'string', description: 'The vendor’s quote number.' },
        status: { type: 'string', enum: [...QUOTE_STATUSES] },
      },
      required: ['vendor'],
      additionalProperties: false,
    },
  },
  {
    name: 'quote_add_from_text',
    module: 'vendors',
    write: true,
    title: 'Make a quote from a file’s words',
    step: 'Made a quote from the file’s words',
    description: 'Make a quote in the Suppliers module from the words of a quote file the person gave (read the file first, then pass its words): the amount, the day it is valid until, its reference and priced lines are read off, never guessed. Say what was read so the person can check it once.',
    parameters: { type: 'object', properties: { text: { type: 'string', description: 'The quote file’s words.' }, vendor: { type: 'string', description: 'Who it is from, when the words do not say plainly.' }, project: { type: 'string' } }, required: ['text'], additionalProperties: false },
  },
  {
    name: 'vendor_add',
    module: 'vendors',
    write: true,
    title: 'Add a vendor',
    step: 'Added a vendor to Suppliers',
    description: 'Add a vendor to the Suppliers module with what the person gave: its name, what it supplies (category), contact, email, phone, website and status. The window’s New vendor, for an assistant.',
    parameters: { type: 'object', properties: { vendor: { type: 'string', description: 'Its name.' }, category: { type: 'string', enum: [...VENDOR_CATEGORIES] }, contact: { type: 'string' }, email: { type: 'string' }, phone: { type: 'string' }, website: { type: 'string' }, status: { type: 'string', enum: [...VENDOR_STATUSES] } }, required: ['vendor'], additionalProperties: false },
  },
  {
    name: 'purchase_order_add',
    module: 'vendors',
    write: true,
    title: 'Add a purchase order',
    step: 'Added a purchase order to Suppliers',
    description: 'Add a purchase order to the Suppliers module (the vendor made as a vendor too when new): its number, amount, the project, the quote it came from, the day it was raised and the delivery day, only with what the person gave. Never guess an amount or a day.',
    parameters: { type: 'object', properties: { vendor: { type: 'string' }, number: { type: 'string', description: 'The order number.' }, amount: { type: 'number' }, project: { type: 'string' }, quote: { type: 'string', description: 'The quote it came from, by its name.' }, raised: { type: 'string', description: 'YYYY-MM-DD (today unless given).' }, delivery: { type: 'string', description: 'YYYY-MM-DD' }, status: { type: 'string', enum: [...PO_STATUSES] } }, required: ['vendor'], additionalProperties: false },
  },
  {
    name: 'quote_accept',
    module: 'vendors',
    write: true,
    title: 'Accept a quote',
    step: 'Accepted a quote in Suppliers',
    description: 'Accept one quote in the Suppliers module (by its vendor or its name, for its project). The other open quotes for the same project are named back, never declined: the person says whether to decline them.',
    parameters: { type: 'object', properties: { quote: { type: 'string', description: 'The quote’s name, or its vendor.' }, project: { type: 'string' } }, required: ['quote'], additionalProperties: false },
  },
  {
    name: 'quote_extend',
    module: 'vendors',
    write: true,
    title: 'Extend a quote',
    step: 'Extended a quote in Suppliers',
    description: 'Extend a quote in the Suppliers module to the new day the person gave (never a guessed day): the quote by its vendor or name, and the day it is now valid until.',
    parameters: { type: 'object', properties: { quote: { type: 'string', description: 'The quote’s name, or its vendor.' }, valid_until: { type: 'string', description: 'The new day, YYYY-MM-DD.' }, project: { type: 'string' } }, required: ['quote', 'valid_until'], additionalProperties: false },
  },
  {
    name: 'contract_expiring',
    module: 'vendors',
    write: false,
    title: 'Contracts and quotes expiring',
    step: 'Checked what ends or lapses in Suppliers',
    description: 'Contracts whose day to give notice or end comes within the days asked (the module’s own reminder window unless given), with renewal terms, and quotes that lapse in that time or have lapsed. Use it for "any contracts up for renewal?", "what expires this month?".',
    parameters: { type: 'object', properties: { days: { type: 'number', description: 'How many days ahead.' } }, additionalProperties: false },
  },
  {
    name: 'contract_add',
    module: 'vendors',
    write: true,
    title: 'Add a contract',
    step: 'Added a contract to Suppliers',
    description: 'Add a contract to the Suppliers module with only what the person gave: vendor, value, how it is charged (period), start and end days, days of notice, whether it auto-renews, the project. Never guess a value or a day.',
    parameters: {
      type: 'object',
      properties: {
        vendor: { type: 'string' },
        amount: { type: 'number', description: 'Its value each period.' },
        period: { type: 'string', enum: [...CONTRACT_PERIODS] },
        starts: { type: 'string', description: 'YYYY-MM-DD' },
        ends: { type: 'string', description: 'YYYY-MM-DD' },
        notice_days: { type: 'number', description: 'Days of notice needed before it ends.' },
        renewal: { type: 'string', enum: [...CONTRACT_RENEWALS] },
        project: { type: 'string' },
        reference: { type: 'string' },
      },
      required: ['vendor'],
      additionalProperties: false,
    },
  },
];

export interface VendorToolInput {
  model: VendorsModel;
  currency: string;
  /** Records of the module the asking agent wasn't allowed (so the answer says so rather than "none"). */
  refused?: number;
  agent?: string;
}

const money = (n: number | null, cur: string) => (n === null ? 'no amount written' : moneyWords(n, cur));

function refusedWords(input: VendorToolInput): string | null {
  const n = input.refused ?? 0;
  if (!n) return null;
  return `${plural(n, 'vendor record')} ${n === 1 ? 'is' : 'are'} marked Work-confidential (or another level) that ${input.agent ?? 'this agent'} isn’t allowed (the person sets this in Ironleaf › Settings › Privacy and secrets). Don’t guess at what ${n === 1 ? 'it says' : 'they say'}.`;
}

function quoteLine(q: Quote, today: string): string {
  const when = q.validUntil ? (q.state === 'Lapsed' ? `lapsed ${dueWords(q.validUntil, today)}` : `valid until ${dueWords(q.validUntil, today)}${q.days !== null && q.days <= 30 && q.days >= 0 ? ` (${whenWords(q.days)})` : ''}`) : 'no valid-until day written';
  return `- ${q.name}: ${q.vendor || 'no vendor'}${q.project ? `, for ${q.project}` : ''}; ${money(q.amount, q.currency)}; ${q.state.toLowerCase()}; ${when}${q.reference ? `; ref ${q.reference}` : ''} [${q.path}]`;
}
function contractLine(c: Contract, today: string, cur: string): string {
  return `- ${c.name}: ${c.vendor || 'no vendor'}${c.project ? `, for ${c.project}` : ''}; ${c.amount !== null ? `${moneyWords(c.amount, cur)} ${c.period === 'One-off' ? 'one-off' : c.period.toLowerCase()}` : 'no value written'}; ${c.ends ? `${c.state === 'Ended' ? 'ended' : 'ends'} ${dueWords(c.ends, today)}${c.days !== null && c.days >= 0 ? ` (${whenWords(c.days)})` : ''}` : 'no end day written'}${c.rolled ? ' (rolled on by its auto-renewal)' : ''}; ${c.renewal.toLowerCase()}${c.noticeBy ? `; give notice by ${dueWords(c.noticeBy, today)}` : ''}; ${c.state.toLowerCase()} [${c.path}]`;
}

/** The answer to one of the read tools (null: not one of these). */
export function answerVendorTool(input: VendorToolInput, name: string, args: Record<string, unknown> = {}): string | null {
  const { model: m, currency: cur } = input;
  const t = m.today;
  const refused = refusedWords(input);
  const done = (lines: (string | null)[]) => [...lines, refused].filter(Boolean).join('\n');
  const has = (field: string, want: unknown) => !str(want) || lower(field).includes(lower(str(want)));
  if (name === 'vendor_list') {
    const list = m.vendors.filter((v) => (!str(args.category) || lower(v.category) === lower(str(args.category))) && has(v.name, args.query));
    if (!list.length) return done([m.vendors.length ? 'No vendor matches that.' : 'No vendors yet.']);
    return done([`${plural(list.length, 'vendor')}:`, ...list.map((v) => `- ${v.name} (${v.category}, ${v.status.toLowerCase()})${v.contact ? `; contact ${v.contact}` : ''}${v.email ? `, ${v.email}` : ''}${v.phone ? `, ${v.phone}` : ''}; ${v.openQuotes ? `${plural(v.openQuotes, 'open quote')} worth ${v.openValueWords}` : 'no open quotes'}; ${plural(v.orders, 'order')}; ${plural(v.activeContracts, 'active contract')}${v.path ? ` [${v.path}]` : ' (no note of its own yet)'}`)]);
  }
  if (name === 'quote_list') {
    const which = str(args.which) || 'open';
    const list = m.quotes.filter((q) => has(q.project, args.project) && has(q.vendor, args.vendor) && (which === 'all' || (which === 'lapsing' ? q.state === 'Lapsed' || q.state === 'Lapses soon' : q.open)));
    if (!list.length) return done([m.quotes.length ? `No ${which === 'all' ? '' : `${which} `}quote matches that.` : 'No quotes yet.']);
    return done([`${plural(list.length, 'quote')}:`, ...list.map((q) => quoteLine(q, t))]);
  }
  if (name === 'quote_compare') {
    const names = Array.isArray(args.quotes) ? args.quotes.map((x) => lower(String(x))) : [];
    const list = names.length ? m.quotes.filter((q) => names.some((n) => lower(q.name) === n || lower(q.name).includes(n))) : str(args.project) ? m.quotes.filter((q) => has(q.project, args.project) && (q.open || q.state === 'Accepted')) : [];
    if (!names.length && !str(args.project)) return 'Say which project’s quotes to compare, or give the quotes’ names.';
    if (list.length < 2) return done([list.length ? `Only one quote matches (${list[0].name}); there is nothing to compare it with.` : 'No quotes match that.']);
    const c = compareQuotes(list);
    const lines: string[] = [`${plural(list.length, 'quote')} side by side${c.sameCurrency ? ', lowest first' : ' (in different currencies, so not ranked)'}:`];
    for (const q of c.quotes) lines.push(`- ${q.vendor || q.name}: ${money(q.amount, q.currency)}${c.cheapest === q.path ? ' (lowest)' : c.over[q.path] ? ` (${moneyWords(c.over[q.path], q.currency)} more)` : ''}; ${q.state.toLowerCase()}${q.validUntil ? `, valid until ${dueWords(q.validUntil, t)}` : ''} [${q.path}]`);
    if (c.rows.length) {
      lines.push('Items:');
      for (const r of c.rows.slice(0, 40)) lines.push(`- ${r.item}: ${r.cells.map((cell, i) => `${c.quotes[i].vendor || c.quotes[i].name} ${cell ? (cell.total !== null ? moneyWords(cell.total, c.quotes[i].currency) : 'listed, no price') : 'not listed'}`).join('; ')}`);
    }
    return done(lines);
  }
  if (name === 'contract_expiring') {
    const days = typeof args.days === 'number' && args.days > 0 ? Math.min(3650, Math.round(args.days)) : m.remindDays;
    const contracts = m.contracts.filter((c) => c.state !== 'Ended' && c.state !== 'Draft' && ((c.days !== null && c.days <= days) || (c.noticeIn !== null && c.noticeIn <= days)));
    const quotes = m.quotes.filter((q) => (q.status === 'Received' || q.status === 'Requested') && q.days !== null && q.days <= days);
    if (!contracts.length && !quotes.length) return done([`Nothing ends, needs notice or lapses in the next ${plural(days, 'day')}.`]);
    return done([contracts.length ? `${plural(contracts.length, 'contract')} to act on in the next ${plural(days, 'day')}:` : null, ...contracts.map((c) => contractLine(c, t, cur)), quotes.length ? `${plural(quotes.length, 'quote')} lapsed or lapsing:` : null, ...quotes.map((q) => quoteLine(q, t))]);
  }
  return null;
}

export interface PlannedVendorNote {
  folder: string;
  name: string;
  text: string;
  words: string;
  /** A vendor note to make first, when the vendor is new. */
  vendor?: { folder: string; name: string; text: string };
}

/** A write tool's new note from its arguments; throws in plain words an agent can pass on. */
export function planVendorWrite(name: string, args: Record<string, unknown>, ctx: { folders: Record<'vendor' | 'quote' | 'contract' | 'order', string>; vendors: readonly string[]; today: string; currency: string }): PlannedVendorNote {
  const vendor = str(args.vendor).slice(0, 80);
  if (!vendor) throw new Error('Say who it is from (the vendor).');
  const known = ctx.vendors.find((v) => lower(v) === lower(vendor));
  const close = known ? null : suggestVendorName(ctx.vendors, vendor);
  if (close) throw new Error(`Did you mean "${close}"? There is no vendor called "${vendor}"; say which one.`);
  const vendorName = known ?? safeFileName(vendor);
  if (name === 'vendor_add') {
    if (known) throw new Error(`${known} is already a vendor.`);
    const v: VendorInput = { name: vendorName, category: str(args.category).slice(0, 40), contact: str(args.contact).slice(0, 100), email: str(args.email).slice(0, 120), phone: str(args.phone).slice(0, 40), website: str(args.website).slice(0, 200), status: str(args.status).slice(0, 20) };
    return { folder: ctx.folders.vendor, name: vendorName, text: newVendorText(v), words: `Added ${vendorName} as a vendor.` };
  }
  const newVendor = known ? undefined : { folder: ctx.folders.vendor, name: vendorName, text: newVendorText({ name: vendorName }) };
  const amount = args.amount === undefined || args.amount === null || args.amount === '' ? null : readMoney(args.amount);
  if (args.amount !== undefined && args.amount !== null && args.amount !== '' && amount === null) throw new Error('Give the amount as a number.');
  const day = (k: string) => {
    if (args[k] === undefined || args[k] === null || args[k] === '') return null;
    const d = readIsoDay(args[k]);
    if (!d) throw new Error(`Give ${k.replace('_', ' ')} as YYYY-MM-DD.`);
    return d;
  };
  const project = str(args.project).slice(0, 120);
  if (name === 'quote_add') {
    const currency = /^[A-Za-z]{3}$/.test(str(args.currency)) && str(args.currency).toUpperCase() !== ctx.currency ? str(args.currency).toUpperCase() : '';
    const q: QuoteInput = { vendor: vendorName, project, amount, currency, received: day('received'), validUntil: day('valid_until'), status: str(args.status) || 'Received', reference: str(args.reference).slice(0, 60), items: Array.isArray(args.items) ? (args.items as ItemInput[]).slice(0, 200) : [] };
    const title = quoteName(q);
    return { folder: ctx.folders.quote, name: title, text: newQuoteText(q, ctx.today), words: `Added the quote ${title}${amount !== null ? ` (${moneyWords(amount, currency || ctx.currency)})` : ''}${q.validUntil ? `, valid until ${dueWords(q.validUntil, ctx.today)}` : ''}${newVendor ? `, and ${vendorName} as a new vendor` : ''}.`, ...(newVendor ? { vendor: newVendor } : {}) };
  }
  if (name === 'purchase_order_add') {
    const o: OrderInput = { vendor: vendorName, project, quote: str(args.quote).slice(0, 120), number: str(args.number).slice(0, 60), amount, raised: day('raised'), delivery: day('delivery'), status: str(args.status) || 'Raised' };
    const title = orderName(o);
    return { folder: ctx.folders.order, name: title, text: newOrderText(o, ctx.today), words: `Added the purchase order ${title}${amount !== null ? ` (${moneyWords(amount, ctx.currency)})` : ''} with ${vendorName}${newVendor ? `, and ${vendorName} as a new vendor` : ''}.`, ...(newVendor ? { vendor: newVendor } : {}) };
  }
  if (name === 'contract_add') {
    const nd = args.notice_days === undefined || args.notice_days === null || args.notice_days === '' ? null : readNumber(args.notice_days);
    if (args.notice_days !== undefined && args.notice_days !== null && args.notice_days !== '' && (nd === null || nd < 0)) throw new Error('Give the notice as a number of days.');
    const c: ContractInput = { vendor: vendorName, project, amount, period: str(args.period) || 'Yearly', starts: day('starts'), ends: day('ends'), noticeDays: nd === null ? null : Math.round(nd), renewal: str(args.renewal) || 'Ends', reference: str(args.reference).slice(0, 60) };
    if (c.starts && c.ends && c.ends < c.starts) throw new Error('The end day is before the start day.');
    const title = contractName(c);
    return { folder: ctx.folders.contract, name: title, text: newContractText(c), words: `Added the contract ${title}${c.ends ? `, ending ${dueWords(c.ends, ctx.today)}` : ''}${newVendor ? `, and ${vendorName} as a new vendor` : ''}.`, ...(newVendor ? { vendor: newVendor } : {}) };
  }
  throw new Error(`There is no tool called ${name}.`);
}

/** A project's quotes, orders and contracts (its page's card) and what needs attention there. */
export function projectVendors(m: VendorsModel, project: { path: string; name: string }, currency: string): { tile: { title: string; rows: { words: string; sub?: string; path?: string; detail?: { kind: 'vendor' | 'quote' | 'contract'; key: string } }[] } | null; attention: { words: string; path: string; tone: 'bad' | 'warn' }[] } {
  const mine = (x: { project: string; projectPath: string | null }) => x.projectPath === project.path || (!!x.project && (lower(x.project) === lower(project.name) || lower(x.project) === lower(nameOf(project.path))));
  const quotes = m.quotes.filter(mine);
  const orders = m.orders.filter(mine);
  const contracts = m.contracts.filter(mine);
  const rows: { words: string; sub?: string; path?: string; detail?: { kind: 'vendor' | 'quote' | 'contract'; key: string } }[] = [];
  for (const q of quotes) rows.push({ words: `${q.vendor || q.name} quote · ${money(q.amount, q.currency)}`, sub: q.validUntil ? `${q.state} · valid until ${dueWords(q.validUntil, m.today)}` : q.state, path: q.path, detail: { kind: 'quote', key: q.path } });
  for (const o of orders) rows.push({ words: `${o.number ? `PO ${o.number}` : o.name}${o.vendor ? ` · ${o.vendor}` : ''}`, sub: [o.amount !== null ? moneyWords(o.amount, currency) : '', o.late ? 'Late' : o.status].filter(Boolean).join(' · '), path: o.path });
  for (const c of contracts) rows.push({ words: `${c.vendor || c.name} contract`, sub: [c.state, c.ends ? `ends ${dueWords(c.ends, m.today)}` : ''].filter(Boolean).join(' · '), path: c.path, detail: { kind: 'contract', key: c.path } });
  const attention = m.attention.filter((a) => [...quotes, ...orders, ...contracts].some((x) => x.path === a.path)).map((a) => ({ words: a.words, path: a.path, tone: a.tone }));
  const open = quotes.filter((q) => q.open).length;
  return { tile: rows.length ? { title: `Quotes and contracts${open ? ` · ${plural(open, 'open quote')}` : ''}`, rows } : null, attention };
}
