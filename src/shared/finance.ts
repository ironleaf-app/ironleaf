// Finance (Wave 5, 24 Oct 2026; module 8 of the catalogue: "Bills, subscriptions, accounts, budgets, receipts · Due-date
// calendar, price-change alerts, monthly spend · Personal (locked)"). Everything here is read from the notes the module
// keeps (src/shared/module-records.ts FINANCE), plain Markdown the person owns:
//
//   Me/Finance/Bills/Internet.md            a Bill: amount, cycle, due (the day it falls, any one of them), category,
//                                           account ([[link]] to an Account), autopay, status, paid (last paid); its
//                                           "## Price history" table keeps every amount it has had, dated
//   Me/Finance/Accounts/Everyday.md         an Account: institution, type, holder, balance; its number is a locked link
//                                           to Secrets ([locked](secret:…)), never the number itself
//   Me/Finance/Budgets/Groceries.md         a Budget: the category is its name; amount and period (Monthly, Weekly, Yearly)
//   Me/Finance/Spending/2026-10.md          a Spending month: one table, a row for each thing spent (Date, What,
//                                           Category, Amount, Account, Receipt), from the bank's CSV or added by hand
//
// A bill's next due day is worked out, never written over: from the day it falls and how often it comes round, after the
// day it was last paid. A bill you pay by hand stays due (then overdue) until it is marked paid; its current cycle's day is
// never skipped. An autopay bill moves on by itself while its debits confirm (marked paid, by hand or the bank's CSV),
// but past its day by more than a week with no confirmation it may not have gone through, and says so (9.2).
//
// Pure: no files, no Node, no DOM. The main side (src/main/modules.ts), the window, the agent tools
// (src/shared/module-tools.ts) and the former host app use it as it is.

import { readTable, column } from './layouts';
import { SPEND_CATEGORIES } from './module-records';
import { cleanFileName } from './paths';

export interface FinanceNote {
  path: string;
  title: string;
  props: Record<string, unknown>;
  content: string;
  /** Its note type's id (bill, bank-account, budget-category, spending-month), as src/shared/note-types.ts reads it. */
  type: string;
}

export interface PricePoint {
  /** YYYY-MM-DD, or '' when the history doesn't say. */
  date: string;
  amount: number;
  note: string;
}

export interface Bill {
  path: string;
  /** Its row's path when it became a note of its own (a page opened from the row still finds it). */
  rowPath?: string;
  name: string;
  /** Other names it is found by (nickname, aliases, its account words) (9.2). */
  names?: string[];
  kind: 'Bill' | 'Subscription';
  amount: number | null;
  cycle: string;
  /** The day it falls as written (any one of them), YYYY-MM-DD. */
  anchor: string | null;
  category: string;
  account: string | null;
  /** The project it belongs to, by name (its `project:` link), or null (10.0 v2money: a bill can belong to a project and shows on it). */
  project: string | null;
  autopay: boolean;
  status: string;
  /** When it was last paid. */
  paid: string | null;
  /** The next day it is due (null: paused, cancelled, a one-off already paid, or no day written). */
  next: string | null;
  /** Days from today to `next` (negative: overdue). */
  days: number | null;
  overdue: boolean;
  /** What it costs a month on average (a yearly bill a twelfth). */
  monthly: number | null;
  history: PricePoint[];
  /** The latest change of price, when its history shows one. */
  change: { from: number; to: number; date: string; recent: boolean } | null;
}

export interface Account {
  path: string;
  name: string;
  /** Other names it is found by (nickname, institution, holder, last4) (9.2). */
  names?: string[];
  institution: string;
  type: string;
  holder: string;
  /** A locked link to Secrets, or '' (the number itself is never kept in the note). */
  number: string;
  balance: number | null;
  asOf: string | null;
}

export interface Budget {
  path: string;
  category: string;
  amount: number | null;
  period: string;
  /** The amount for a month. */
  monthly: number | null;
  spent: number;
  left: number | null;
  /** Spent as a share of the month's budget, 0–100+ (null without an amount). */
  progress: number | null;
}

export interface Spend {
  id: string;
  /** The Spending month note it is a row of, and its row there (from 0). */
  path: string;
  row: number;
  date: string;
  what: string;
  category: string;
  amount: number;
  account: string;
  receipt: string;
}

/** Spending rows that move money between the person's own accounts (card and loan repayments): kept as rows, never
 *  counted in totals, months or budgets (9.2). */
export const TRANSFERS_CATEGORY = 'Transfers';

export interface MonthSpend {
  /** YYYY-MM */
  month: string;
  total: number;
  byCategory: Record<string, number>;
  /** Card and loan repayments that month: recorded, but not spending. */
  transfers: number;
}

export interface FinanceModel {
  bills: Bill[];
  accounts: Account[];
  budgets: Budget[];
  spending: Spend[];
  /** The last twelve months with spending, oldest first. */
  months: MonthSpend[];
  /** YYYY-MM of today. */
  thisMonth: string;
  /** What the active bills cost a month together. */
  committed: number;
  /** Active bills due within the next 14 days (and overdue ones), soonest first. */
  dueSoon: Bill[];
  /** Bills whose price changed in the last 45 days. */
  priceChanges: Bill[];
  today: string;
}

// ── Small readers ────────────────────────────────────────────────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, '0');
export const isoOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const dateOf = (iso: string) => new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
export const addDays = (iso: string, n: number) => isoOf(new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)) + n));
const DAY = 86_400_000;
export const daysFrom = (a: string, b: string) => Math.round((dateOf(b).getTime() - dateOf(a).getTime()) / DAY);
const str = (v: unknown) => (Array.isArray(v) ? String(v[0] ?? '') : v === null || v === undefined ? '' : String(v)).trim();
/** A cell's plain words: a [[link]] reads as its name (an alias wins), a bare name as itself. What the
 *  Money page shows for an account or project; the two-PC card shows the same for every version. */
export const linkName = (v: unknown) => {
  const s = str(v);
  const m = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/.exec(s);
  const raw = m ? (m[2] ?? m[1].split('/').pop()!.replace(/\.md$/i, '')) : s.replace(/^\[|\]$/g, '').split('/').pop()!.replace(/\.md$/i, '');
  return raw.trim();
};

/** An account's cell in Spending: always the [[link]] form (2 Nov 2026, money parity F1: a bare
 *  name broke the link the bill keeps). A bare name, path or link all land as [[Name]]. */
export function accountCellOf(raw: unknown): string {
  const name = linkName(raw);
  return name ? `[[${name.slice(0, 80)}]]` : '';
}

/** An amount as people write it ("$1,234.50", "22.99", "AUD 89", "-12.40", "1.234,50") → a number, else null. */
export function readMoney(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
  // European thousands/decimals ("1.234,50") read as written, never as ~1.23 (9.2).
  const eu = /^-?\(?[$€£]?\s?\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?\)?$/.test(str(v).trim());
  const s = (eu ? str(v).replace(/\./g, '').replace(',', '.') : str(v).replace(/[\s,]/g, '')).replace(/^[A-Z]{3}/i, '').replace(/[A-Z]{3}$/i, '');
  const neg = /^\(.*\)$/.test(s) || /^-/.test(s) || /^\$?-/.test(s);
  // A thousands/millions/billions suffix ("$1.5k") multiplies; anything else keeps the bare figure.
  const suf = /^[(+\-$€£¥]*\$?\d+(?:\.\d+)?([kmb])$/i.exec(s.replace(/^\(|\)$/g, ''));
  const mult = !suf ? 1 : suf[1].toLowerCase() === 'k' ? 1000 : suf[1].toLowerCase() === 'm' ? 1_000_000 : 1_000_000_000;
  const m = /(\d+(?:\.\d+)?)/.exec(s.replace(/^\(|\)$/g, ''));
  if (!m || !/^[(+\-$€£¥]*\$?\d/.test(s.replace(/^\(/, ''))) return null;
  const n = Math.round(Number(m[1]) * mult * 100) / 100;
  return neg ? -n : n;
}

const MONTH_WORDS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** A day as written in a note's property or a table ("2026-11-14", "14/11/2026", "14 Nov 2026") → YYYY-MM-DD, else null.
 *  Day before month, as Australians write it, unless `order` says otherwise. */
export function readIsoDay(v: unknown, order: 'dmy' | 'mdy' = 'dmy'): string | null {
  const s = str(v);
  if (!s) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return valid(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(s);
  if (m) {
    const y = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]);
    const [d, mo] = order === 'mdy' ? [Number(m[2]), Number(m[1])] : [Number(m[1]), Number(m[2])];
    return valid(y, mo, d);
  }
  m = /^(?:[a-z]{3,9},?\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\.?,?\s+(\d{4})/i.exec(s);
  if (m) return valid(Number(m[3]), MONTH_WORDS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1, Number(m[1]));
  m = /^(?:[a-z]{3,9},?\s+)?([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/i.exec(s);
  if (m) return valid(Number(m[3]), MONTH_WORDS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1, Number(m[2]));
  return null;
}
function valid(y: number, mo: number, d: number): string | null {
  if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const x = new Date(y, mo - 1, d);
  return x.getMonth() === mo - 1 ? isoOf(x) : null;
}

const yes = (v: unknown) => /^(yes|true|y|on|auto|autopay)$/i.test(str(v)) || v === true;

// ── Cycles ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A cycle as written → its canonical word ("monthly", "every month" → Monthly; unknown → Monthly). */
export function readCycle(v: unknown): string {
  const s = str(v).toLowerCase();
  if (/^(once|one[- ]?off|single)$/.test(s)) return 'Once';
  if (/week/.test(s) && /2|two|fort/.test(s)) return 'Fortnightly';
  if (/fortnight/.test(s)) return 'Fortnightly';
  if (/week/.test(s)) return 'Weekly';
  if (/quarter|3 ?month/.test(s)) return 'Quarterly';
  if (/half|6 ?month|bi-?annual|semi/.test(s)) return 'Half-yearly';
  if (/year|annual|12 ?month/.test(s)) return 'Yearly';
  return 'Monthly';
}

const PER_MONTH: Record<string, number> = { Weekly: 52 / 12, Fortnightly: 26 / 12, Monthly: 1, Quarterly: 1 / 3, 'Half-yearly': 1 / 6, Yearly: 1 / 12, Once: 0 };
const CYCLE_DAYS: Record<string, number> = { Weekly: 7, Fortnightly: 14, Monthly: 30, Quarterly: 91, 'Half-yearly': 182, Yearly: 365, Once: 0 };

/** What an amount on a cycle costs a month, to the cent. */
export const monthlyOf = (amount: number, cycle: string) => Math.round(amount * (PER_MONTH[cycle] ?? 1) * 100) / 100;

/** What bills come to a month together (8.0 R5): each live bill's monthly cost added up (a yearly bill a twelfth, a
 *  weekly one 52/12); paused, cancelled and amount-less bills count nothing. The one sum Finance's overview, its
 *  Bills page and Today all use. */
export function billsMonthlyTotal(bills: readonly Pick<Bill, 'monthly'>[]): number {
  return Math.round(bills.reduce((s, b) => s + (b.monthly ?? 0), 0) * 100) / 100;
}

/** The k-th time a bill falls after its day (k may be negative). Months keep the day (the 31st falls on the last day). */
export function occurrence(anchor: string, cycle: string, k: number): string {
  const a = dateOf(anchor);
  if (cycle === 'Weekly' || cycle === 'Fortnightly') return isoOf(new Date(a.getFullYear(), a.getMonth(), a.getDate() + k * (cycle === 'Weekly' ? 7 : 14)));
  const months = cycle === 'Quarterly' ? 3 : cycle === 'Half-yearly' ? 6 : cycle === 'Yearly' ? 12 : 1;
  const target = new Date(a.getFullYear(), a.getMonth() + k * months, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return isoOf(new Date(target.getFullYear(), target.getMonth(), Math.min(a.getDate(), last)));
}

/** The first time a bill falls on or after a day. */
export function firstOnOrAfter(anchor: string, cycle: string, day: string): string {
  if (cycle === 'Once') return anchor;
  // A rough start, then exact steps (never more than a few).
  const span = CYCLE_DAYS[cycle] || 30;
  let k = Math.floor(daysFrom(anchor, day) / span) - 1;
  let at = occurrence(anchor, cycle, k);
  for (let i = 0; i < 400 && at < day; i++) at = occurrence(anchor, cycle, ++k);
  while (k > -400 && occurrence(anchor, cycle, k - 1) >= day) at = occurrence(anchor, cycle, --k);
  return at;
}

/** Days an autopay debit gets to show up before the bill is flagged (9.2, 1 Nov 2026: an autopay bill past its day
 *  with no confirmation — no marked paid, no bank row — may not have gone through, e.g. too little in the account.
 *  The bell says it once per occurrence, and marking it paid clears it). */
export const AUTOPAY_GRACE_DAYS = 7;

/** The occurrence a payment on `paid` covers: the first day the bill falls on or after half a cycle before the
 *  payment (a bill paid a few days early covers the coming one). */
export function occurrenceCoveredBy(anchor: string, cycle: string, paid: string): string {
  const half = Math.max(3, Math.floor((CYCLE_DAYS[cycle] || 30) / 2));
  return firstOnOrAfter(anchor, cycle, isoOf(new Date(dateOf(paid).getTime() - half * DAY)));
}

/** The anchor advanced past the occurrence paid on `paid` (the note's `due:` moves with each payment, so the note
 *  always shows the coming cycle, never a stale one). Once: unchanged — paid means done. */
export function advanceAnchor(anchor: string, cycle: string, paid: string): string {
  if (cycle === 'Once') return anchor;
  const covered = occurrenceCoveredBy(anchor, cycle, paid);
  const next = firstOnOrAfter(anchor, cycle, isoOf(new Date(dateOf(covered).getTime() + DAY)));
  return next > paid ? next : anchor;
}

/** The latest day the bill fell on or before `today` (null when every occurrence is still to come). Days before the
 *  anchor never happened: a new bill's first day is its first day. */
export function latestOccurrence(anchor: string, cycle: string, today: string): string | null {
  if (cycle === 'Once') return anchor <= today ? anchor : null;
  const span = CYCLE_DAYS[cycle] || 30;
  let d = firstOnOrAfter(anchor, cycle, isoOf(new Date(dateOf(today).getTime() - span * DAY)));
  if (d > today || d < anchor) return null;
  for (let i = 0; i < 8; i++) {
    const n = firstOnOrAfter(anchor, cycle, isoOf(new Date(dateOf(d).getTime() + DAY)));
    if (n <= today && n > d) d = n;
    else break;
  }
  return d;
}

/** The next day a bill is due, with whether it is overdue. */
export function nextDue(input: { anchor: string | null; cycle: string; paid: string | null; autopay: boolean; status: string }, today: string): { next: string | null; overdue: boolean } {
  const { anchor, cycle, paid, autopay, status } = input;
  if (!anchor || /^(paused|cancelled|canceled|stopped|ended)$/i.test(status)) return { next: null, overdue: false };
  if (cycle === 'Once') {
    if (paid) return { next: null, overdue: false };
    return { next: anchor, overdue: anchor < today };
  }
  // Autopay past its day with nothing confirming it: it may not have gone through (9.2). A marked paid covers its
  // occurrence (paid early for the coming one counts: the cycle is covered).
  if (autopay) {
    const recent = latestOccurrence(anchor, cycle, today);
    const covered = paid ? occurrenceCoveredBy(anchor, cycle, paid) : null;
    if (recent && daysFrom(recent, today) > AUTOPAY_GRACE_DAYS && (!covered || covered < recent)) return { next: recent, overdue: true };
  }
  const half = Math.max(3, Math.floor((CYCLE_DAYS[cycle] || 30) / 2));
  let from: string;
  if (paid) {
    // The first day it falls well after it was last paid (a bill paid a few days early is that one paid).
    const after = isoOf(new Date(dateOf(paid).getTime() + (half + 1) * DAY));
    from = after;
    const prev = firstOnOrAfter(anchor, cycle, isoOf(new Date(dateOf(paid).getTime() - half * DAY)));
    if (prev > paid && daysFrom(paid, prev) > half) from = prev;
  } else if (autopay) from = today;
  // Not on autopay and unpaid: the current cycle's day, never skipped (9.2: a bill due 1 Oct still unpaid on 24 Oct stays due
  // 1 Oct, overdue — the old fortnight look-back rolled it to 1 Nov with no flag). Never before the anchor: a new
  // bill's first day is its first day.
  else {
    const floor = isoOf(new Date(dateOf(today).getTime() - (CYCLE_DAYS[cycle] || 30) * DAY));
    from = anchor > floor ? anchor : floor;
  }
  // An autopay bill with its debits confirming moves on to its next day by itself.
  if (autopay && from < today) from = today;
  const next = firstOnOrAfter(anchor, cycle, from);
  return { next, overdue: next < today };
}

// ── Reading the notes ────────────────────────────────────────────────────────────────────────────────────────────────

/** The "## Price history" table of a bill (the first table in it): each amount it has had, oldest first. */
export function priceHistory(content: string): PricePoint[] {
  const at = /^#{2,3}\s+price history\s*$/im.exec(content);
  const body = at ? content.slice(at.index) : '';
  const t = body ? readTable(body.replace(/^#{2,3}[^\n]*\n/, '').split(/\n#{1,3}\s/)[0]) : null;
  if (!t) return [];
  const d = column(t, /^(date|when|from)$/i);
  const a = column(t, /^(amount|price|cost)$/i);
  const n = column(t, /^(note|why|notes)$/i);
  const out: PricePoint[] = [];
  for (const row of t.rows) {
    const amount = readMoney(row[a >= 0 ? a : 1]);
    if (amount === null) continue;
    out.push({ date: readIsoDay(row[d >= 0 ? d : 0]) ?? '', amount, note: (n >= 0 ? row[n] : '') ?? '' });
  }
  return out.sort((x, y) => (x.date && y.date ? x.date.localeCompare(y.date) : 0));
}

const nameList = (p: Record<string, unknown>, extra: unknown[] = []): string[] => [...new Set([p.nickname, ...(Array.isArray(p.aliases) ? p.aliases : p.aliases ? [p.aliases] : []), ...extra].map((x) => str(x)).filter(Boolean))];

function readBill(n: FinanceNote, today: string): Bill {
  const p = n.props;
  const amount = readMoney(p.amount);
  const cycle = readCycle(p.cycle);
  const anchor = readIsoDay(p.due);
  const status = str(p.status) || 'Active';
  const autopay = yes(p.autopay);
  const paid = readIsoDay(p.paid);
  const { next, overdue } = nextDue({ anchor, cycle, paid, autopay, status }, today);
  const history = priceHistory(n.content);
  let change: Bill['change'] = null;
  for (let i = history.length - 1; i > 0; i--) {
    if (history[i].amount !== history[i - 1].amount) {
      const date = history[i].date;
      change = { from: history[i - 1].amount, to: history[i].amount, date, recent: !!date && daysFrom(date, today) <= 45 && daysFrom(date, today) >= 0 };
      break;
    }
  }
  const active = !/^(paused|cancelled|canceled|stopped|ended)$/i.test(status);
  return {
    path: n.path,
    name: n.title,
    names: nameList(p),
    kind: /sub/i.test(str(p.kind)) ? 'Subscription' : 'Bill',
    amount,
    cycle,
    anchor,
    category: str(p.category) || 'Other',
    account: linkName(p.account) || null,
    project: linkName(p.project) || null,
    autopay,
    status,
    paid,
    next,
    days: next ? daysFrom(today, next) : null,
    overdue,
    monthly: amount !== null && active ? monthlyOf(amount, cycle) : null,
    history,
    change,
  };
}

function readAccount(n: FinanceNote): Account {
  const p = n.props;
  return { path: n.path, name: n.title, names: nameList(p, [p.institution, p.holder, p.last4 ? `last4 ${str(p.last4)}` : '']), institution: str(p.institution), type: str(p.kind) || str(p.type_of) || 'Everyday', holder: str(p.holder), number: str(p.number), balance: readMoney(p.balance), asOf: readIsoDay(p.as_of) };
}

/** The rows of a Spending month note. */
export function spendRows(n: Pick<FinanceNote, 'path' | 'content'>): Spend[] {
  const at = /^#{2,3}\s+spending\s*$/im.exec(n.content);
  const t = readTable(at ? n.content.slice(at.index) : n.content);
  if (!t) return [];
  const c = { date: column(t, /^date$/i), what: column(t, /^(what|description|details|payee)$/i), category: column(t, /^category$/i), amount: column(t, /^amount$/i), account: column(t, /^account$/i), receipt: column(t, /^receipt$/i) };
  const out: Spend[] = [];
  t.rows.forEach((row, i) => {
    const amount = readMoney(row[c.amount]);
    const date = readIsoDay(row[c.date]);
    if (amount === null || !date) return;
    out.push({ id: `${n.path}::spend:${i}`, path: n.path, row: i, date, what: (row[c.what] ?? '').trim(), category: (row[c.category] ?? '').trim() || 'Other', amount, account: linkName(row[c.account] ?? ''), receipt: (row[c.receipt] ?? '').trim() });
  });
  return out;
}

const PER_MONTH_BUDGET: Record<string, number> = { Monthly: 1, Weekly: 52 / 12, Yearly: 1 / 12 };

/** Everything the Finance module shows, from its notes. */
export function financeModel(notes: readonly FinanceNote[], today: Date = new Date()): FinanceModel {
  const t = isoOf(today);
  const thisMonth = t.slice(0, 7);
  const bills = notes.filter((n) => n.type === 'bill').map((n) => readBill(n, t));
  const accounts = notes.filter((n) => n.type === 'bank-account').map(readAccount);
  const spending = notes
    .filter((n) => n.type === 'spending-month')
    .flatMap(spendRows)
    .sort((a, b) => a.date.localeCompare(b.date) || a.row - b.row);
  const monthMap = new Map<string, MonthSpend>();
  for (const s of spending) {
    const m = s.date.slice(0, 7);
    const ms = monthMap.get(m) ?? { month: m, total: 0, byCategory: {}, transfers: 0 };
    if (s.category === TRANSFERS_CATEGORY) ms.transfers = Math.round((ms.transfers + s.amount) * 100) / 100;
    else {
      ms.total = Math.round((ms.total + s.amount) * 100) / 100;
      ms.byCategory[s.category] = Math.round(((ms.byCategory[s.category] ?? 0) + s.amount) * 100) / 100;
    }
    monthMap.set(m, ms);
  }
  const months = [...monthMap.values()].sort((a, b) => a.month.localeCompare(b.month)).slice(-12);
  const spentNow = monthMap.get(thisMonth)?.byCategory ?? {};
  const budgets = notes
    .filter((n) => n.type === 'budget-category')
    .map((n): Budget => {
      const amount = readMoney(n.props.amount);
      const period = /week/i.test(str(n.props.period)) ? 'Weekly' : /year|annual/i.test(str(n.props.period)) ? 'Yearly' : 'Monthly';
      const monthly = amount === null ? null : Math.round(amount * PER_MONTH_BUDGET[period] * 100) / 100;
      const key = n.title.toLowerCase();
      const spent = Object.entries(spentNow).reduce((sum, [cat, v]) => (cat.toLowerCase() === key ? sum + v : sum), 0);
      return { path: n.path, category: n.title, amount, period, monthly, spent: Math.round(spent * 100) / 100, left: monthly === null ? null : Math.round((monthly - spent) * 100) / 100, progress: monthly ? Math.round((spent / monthly) * 100) : null };
    })
    .sort((a, b) => a.category.localeCompare(b.category));
  const committed = billsMonthlyTotal(bills);
  const dueSoon = bills.filter((b) => b.next && b.days !== null && b.days <= 14).sort((a, b) => a.next!.localeCompare(b.next!));
  const priceChanges = bills.filter((b) => b.change?.recent);
  return { bills, accounts, budgets, spending, months, thisMonth, committed, dueSoon, priceChanges, today: t };
}

// ── Bills due on Today (3 Nov 2026, fourth-round G1: the figures counted steps and dated lines only, while the brief
// showed bills as overdue/due, so one count sat above two late rows) ─────────────────────────────────────────────
// One due list for the brief, the Bills card and Today's figures/welcome/all-clear, so the three can never disagree
// again: overdue or due within ahead (at least 7 days, more when the person asked for earlier warning), soonest
// first. Just-paid rows are paid, not due, so never in the list (the Bills card still shows them as Paid, uncounted).
/** Just paid: paid in the last week and now due more than a week out (the Bills card's Paid row, never a due). */
export function isJustPaid(b: Pick<Bill, 'paid' | 'days'>, today: string): boolean {
  return !!b.paid && b.paid >= addDays(today, -7) && b.days !== null && b.days > 7;
}
/** A bill's front matter as a door that reads files directly has it (a bill note's props, or a Bills-table row's
 *  cells as `billsRowProps` shapes them): the raw values, read here, never re-read there. */
export interface BillNoteProps {
  due?: unknown;
  paid?: unknown;
  cycle?: unknown;
  autopay?: unknown;
  status?: unknown;
}
/** A bill note's due reading from its raw props (t129, 9 Nov 2026: the former host app's morning brief read the
 *  written day with its own window while Vault rolls cycles on, so the two briefs disagreed): the cycle-aware
 *  next day, days from today, whether overdue, and the paid day — exactly what `billsDue` counts on. Doors
 *  that read files directly call this, then `billsDue`, and show the same bills Vault shows. */
export function billDueOf(props: BillNoteProps, today: string): Pick<Bill, 'next' | 'days' | 'overdue' | 'paid'> {
  const anchor = readIsoDay(props.due);
  const paid = readIsoDay(props.paid);
  const { next, overdue } = nextDue({ anchor, cycle: readCycle(props.cycle), paid, autopay: yes(props.autopay), status: str(props.status) || 'Active' }, today);
  return { next, days: next ? daysFrom(today, next) : null, overdue, paid };
}
/** Every bill the person still owes soon: overdue or due within ahead, just-paid left out, soonest first. */
export function billsDue<T extends Pick<Bill, 'next' | 'days' | 'overdue' | 'paid'>>(bills: readonly T[], remindDays: number, today: string): T[] {
  const ahead = Math.max(7, remindDays);
  return bills.filter((b) => b.next && b.days !== null && (b.overdue || b.days <= ahead) && !isJustPaid(b, today)).sort((a, b) => (a.next ?? '').localeCompare(b.next ?? ''));
}
/** Bills due as head figures: overdue, today and within ahead count (week carries to ahead, so every bill the brief
 *  shows is counted and the hero never says All clear above one). Null (Money not loaded yet): nothing. */
export function billsHeadCounts(bills: readonly Pick<Bill, 'next' | 'days' | 'overdue' | 'paid'>[] | null, remindDays: number, today: string): { late: number; today: number; week: number } {
  if (!bills) return { late: 0, today: 0, week: 0 };
  const due = billsDue(bills, remindDays, today);
  const ahead = Math.max(7, remindDays);
  return { late: due.filter((b) => b.overdue || (b.days ?? 0) < 0).length, today: due.filter((b) => !b.overdue && b.days === 0).length, week: due.filter((b) => !b.overdue && b.days !== null && b.days >= 1 && b.days <= ahead).length };
}
/** Whether bills keep "Nothing on you yet" away: any overdue, today or within-ahead bill is on the person. */
export function billsKeepWelcome(bills: readonly Pick<Bill, 'next' | 'days' | 'overdue' | 'paid'>[] | null, remindDays: number, today: string): boolean {
  const c = billsHeadCounts(bills, remindDays, today);
  return c.late + c.today + c.week > 0;
}

// ── The next 90 days: what is coming, what is expected in, and whether a new cost fits (30 Oct 2026, 8.3 wave 1) ────
// Every active bill is laid on each day it falls in the window (a yearly one is a renewal), beside the pay the person
// said to expect (Finance options, or a tool's own words). Weeks are 7 days from today; the tightest is the one whose
// running balance (from the accounts' balances, when any is written) is lowest. Pure, like the rest of this file.

export interface IncomeEntry {
  name: string;
  amount: number;
  cycle: string;
  /** The next day it is expected, YYYY-MM-DD. */
  next: string | null;
}

export interface ForecastEvent {
  date: string;
  name: string;
  kind: 'bill' | 'subscription' | 'renewal' | 'income';
  /** Money out is positive for bills; income is money in. */
  amount: number;
  path?: string;
}

export interface ForecastWeek {
  start: string;
  end: string;
  out: number;
  in: number;
  net: number;
  /** The balance at the week's end, when a starting balance is known. */
  balance: number | null;
}

export interface FinanceForecast {
  from: string;
  to: string;
  days: number;
  events: ForecastEvent[];
  totalOut: number;
  totalIn: number;
  /** The spendable accounts' balances added up, when at least one is written (cards, loans and locked savings never
   *  count as money to spend). */
  startingBalance: number | null;
  /** What is owed on cards and loans, when any is written (balances as written: what is owed, positive). */
  debtTotal: number | null;
  debts: { name: string; amount: number; path: string }[];
  weeks: ForecastWeek[];
  tightest: ForecastWeek | null;
}

/** An account's balance counts as money to spend only when it can be spent (Everyday, Savings, and anything not
 *  named below). Cards, loans and mortgages are owed, not held; super and investments are locked away (9.2: the
 *  forecast once added a $2,000 card debt to the balance and said a $3,000 repair fits). */
const DEBT_ACCOUNT = /credit|card|loan|mortgage|debt/i;
const LOCKED_ACCOUNT = /super|investment/i;

/** Expected pay from Finance's own settings (its options form), or none when the person hasn't said. */
export function incomeFromSettings(settings: Record<string, string | number | boolean> | undefined): IncomeEntry[] {
  const amount = readMoney(settings?.income_amount);
  const next = readIsoDay(settings?.income_next);
  if (amount === null || amount <= 0) return [];
  return [{ name: String(settings?.income_name ?? '').trim().slice(0, 60) || 'Pay', amount, cycle: readCycle(settings?.income_cycle ?? 'Monthly'), next }];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function financeForecast(model: Pick<FinanceModel, 'bills' | 'accounts' | 'today'>, opts: { days?: number; income?: readonly IncomeEntry[] } = {}): FinanceForecast {
  const days = Math.max(1, Math.min(366, Math.round(opts.days ?? 90)));
  const from = model.today;
  const to = isoOf(new Date(dateOf(from).getTime() + (days - 1) * DAY));
  const events: ForecastEvent[] = [];
  for (const b of model.bills) {
    if (!b.next || b.amount === null) continue;
    let date: string | null = b.next;
    let first = true;
    for (let guard = 0; date && date <= to && guard < 500; guard++) {
      // Already due is due now (9.2 fresh eyes): laid on the window's first day, so weeks and totals count it once.
      events.push({ date: first && date < from ? from : date, name: b.name, kind: b.cycle === 'Yearly' || b.cycle === 'Half-yearly' ? 'renewal' : b.kind === 'Subscription' ? 'subscription' : 'bill', amount: b.amount, path: b.path });
      first = false;
      if (b.cycle === 'Once' || !b.anchor) break;
      date = firstOnOrAfter(b.anchor, b.cycle, isoOf(new Date(dateOf(date).getTime() + DAY)));
    }
  }
  for (const inc of opts.income ?? []) {
    if (!inc.next || !(inc.amount > 0)) continue;
    const cycle = readCycle(inc.cycle);
    let date: string | null = inc.next < from ? (cycle === 'Once' ? null : firstOnOrAfter(inc.next, cycle, from)) : inc.next;
    for (let guard = 0; date && date <= to && guard < 500; guard++) {
      events.push({ date, name: inc.name || 'Pay', kind: 'income', amount: inc.amount });
      if (cycle === 'Once') break;
      date = firstOnOrAfter(inc.next, cycle, isoOf(new Date(dateOf(date).getTime() + DAY)));
    }
  }
  events.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
  const spendable = model.accounts.filter((a) => !DEBT_ACCOUNT.test(a.type) && !LOCKED_ACCOUNT.test(a.type)).map((a) => a.balance).filter((x): x is number => x !== null);
  const startingBalance = spendable.length ? round2(spendable.reduce((s, x) => s + x, 0)) : null;
  const debts = model.accounts.filter((a) => DEBT_ACCOUNT.test(a.type) && a.balance !== null).map((a) => ({ name: a.name, amount: Math.abs(a.balance as number), path: a.path }));
  const debtTotal = debts.length ? round2(debts.reduce((s, d) => s + d.amount, 0)) : null;
  const weeks: ForecastWeek[] = [];
  let balance = startingBalance;
  for (let start = from; start <= to; ) {
    const end = isoOf(new Date(Math.min(dateOf(start).getTime() + 6 * DAY, dateOf(to).getTime())));
    const mine = events.filter((e) => e.date >= start && e.date <= end);
    const out = round2(mine.filter((e) => e.kind !== 'income').reduce((s, e) => s + e.amount, 0));
    const inn = round2(mine.filter((e) => e.kind === 'income').reduce((s, e) => s + e.amount, 0));
    const net = round2(inn - out);
    balance = balance === null ? null : round2(balance + net);
    weeks.push({ start, end, out, in: inn, net, balance });
    start = isoOf(new Date(dateOf(end).getTime() + DAY));
  }
  const tightest = weeks.length ? [...weeks].sort((a, b) => (a.balance ?? a.net) - (b.balance ?? b.net) || a.start.localeCompare(b.start))[0] : null;
  return { from, to, days, events, totalOut: round2(events.filter((e) => e.kind !== 'income').reduce((s, e) => s + e.amount, 0)), totalIn: round2(events.filter((e) => e.kind === 'income').reduce((s, e) => s + e.amount, 0)), startingBalance, debtTotal, debts, weeks, tightest };
}

/** The largest money out in the look-ahead (9.5 fresh eyes, 2 Nov 2026): the biggest bill,
 *  subscription or renewal — never income, however large. Money out is positive for bills, so
 *  this is the maximum, not the minimum. Undefined when nothing goes out. */
/** A forecast week as words ("3 to 9 Nov", or "28 Oct to 3 Nov" across months). */
export function forecastWeekRange(w: Pick<ForecastWeek, 'start' | 'end'>): string {
  const day = (iso: string) => `${Number(iso.slice(8, 10))} ${SHORT_MONTHS[Number(iso.slice(5, 7)) - 1]}`;
  return w.start.slice(0, 7) === w.end.slice(0, 7) ? `${Number(w.start.slice(8, 10))} to ${day(w.end)}` : `${day(w.start)} to ${day(w.end)}`;
}

/** The Money first screen's looking-ahead line: what goes out, what is expected in, and the tightest week. Null when
 *  there is nothing to look ahead at yet. */
export function forecastHeadline(fc: Pick<FinanceForecast, 'events' | 'totalOut' | 'totalIn' | 'tightest'>, currency: string): string | null {
  if (!fc.events.length) return null;
  const bits = [`${moneyWords(fc.totalOut, currency)} going out in the next 90 days`];
  if (fc.totalIn) bits.push(`${moneyWords(fc.totalIn, currency)} expected in`);
  if (fc.tightest) bits.push(`tightest week ${forecastWeekRange(fc.tightest)}${fc.tightest.balance !== null ? `, ending at ${moneyWords(fc.tightest.balance, currency)}` : ''}`);
  return bits.join(' · ');
}

export function biggestOut(events: readonly ForecastEvent[]): ForecastEvent | undefined {
  return events.filter((e) => e.kind !== 'income').sort((a, b) => b.amount - a.amount || a.date.localeCompare(b.date))[0];
}

/** Whether a new cost fits in the look-ahead: after paying it at the start, the lowest running balance (or, with no
 *  balance written, the money in less the money out) stays at or above nought. `spare` is that lowest point. */
export function affordCheck(forecast: FinanceForecast, amount: number): { ok: boolean; spare: number; balanceKnown: boolean; known: boolean } {
  const lows = forecast.weeks.map((w) => (forecast.startingBalance !== null ? (w.balance ?? 0) : w.net));
  // With no balance written, weeks are judged together: what comes in over the whole window less what goes out.
  const spare = forecast.startingBalance !== null ? round2((lows.length ? Math.min(...lows) : forecast.startingBalance) - amount) : round2(forecast.totalIn - forecast.totalOut - amount);
  // `known`: with neither a balance nor any pay written there is nothing to measure against, so no yes or no is given
  // (30 Oct 2026: "Not yet: it would go $48,301 under" for every amount on a vault with no pay written helped nobody).
  return { ok: spare >= 0, spare, balanceKnown: forecast.startingBalance !== null, known: forecast.startingBalance !== null || forecast.totalIn > 0 };
}

// ── Money in words ───────────────────────────────────────────────────────────────────────────────────────────────────

/** "$1,234.50" (the currency's own sign; A$ never needed for Australians). */
export function moneyWords(n: number | null | undefined, currency = 'AUD'): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '';
  try {
    return new Intl.NumberFormat('en-AU', { style: 'currency', currency, minimumFractionDigits: Number.isInteger(n) && Math.abs(n) >= 1000 ? 0 : 2, maximumFractionDigits: 2 }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** "Tue 3 Nov" (with the year when it isn't this one). As written when the day cannot be read (8.7 urgent,
 *  30 Oct 2026): never a crash, never "undefined NaN undefined". */
export function dueWords(iso: string, today: string): string {
  const day = readIsoDay(iso);
  if (!day) return String(iso ?? '').trim();
  const d = dateOf(day);
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${SHORT_MONTHS[d.getMonth()]}${day.slice(0, 4) !== today.slice(0, 4) ? ` ${day.slice(0, 4)}` : ''}`;
}
/** "today", "tomorrow", "in 5 days", "3 days ago". */
export function whenWords(days: number): string {
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}
export const monthWords = (ym: string) => `${SHORT_MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

// ── Writing ──────────────────────────────────────────────────────────────────────────────────────────────────────────
// New notes are written here as plain text (so the former host app can write one too, with nothing else built in);
// changes to a note the person already has go through the app's own property writer (src/main/modules.ts) so nothing
// else moves.

const yamlWords = (s: string) => (s === '' || /^[\s\-?:,[\]{}#&*!|>'"%@`]|:\s|:$|\s#|\s$/.test(s) || /^(true|false|yes|no|null|on|off|~)$/i.test(s) || /^[\d.+-]+$/.test(s) ? JSON.stringify(s) : s);
const cell = (s: string) => String(s ?? '').replace(/[\r\n]+/g, ' ').replace(/\|/g, '\\|').trim();
export const safeFileName = (name: string): string => cleanFileName(name, 'Untitled', 80).replace(/^[. ]+/, '') || 'Untitled';

export interface BillInput {
  name: string;
  amount?: number | null;
  cycle?: string;
  due?: string | null;
  category?: string;
  account?: string;
  project?: string;
  autopay?: boolean;
  kind?: 'Bill' | 'Subscription';
}

/** A new Bill note's words: its properties, an empty price history and a Notes section (2 Nov 2026: a new bill's
 *  first amount is not a price change, so the history starts empty — only a real change adds a row). */
export function newBillText(b: BillInput): string {
  const amount = b.amount ?? null;
  const front = [
    'type: bill',
    `kind: ${b.kind ?? (b.category === 'Subscriptions' ? 'Subscription' : 'Bill')}`,
    `amount: ${amount === null ? '' : amount.toFixed(2)}`.trimEnd(),
    `cycle: ${readCycle(b.cycle ?? 'Monthly')}`,
    `due: ${b.due ?? ''}`.trimEnd(),
    `category: ${yamlWords(b.category || 'Other')}`,
    b.account ? `account: "[[${b.account.replace(/"/g, '')}]]"` : 'account:',
    b.project ? `project: "[[${b.project.replace(/"/g, '').slice(0, 120)}]]"` : 'project:',
    `autopay: ${b.autopay ? 'Yes' : 'No'}`,
    'status: Active',
  ];
  // No empty Price history on a new bill (reviewer, 2 Nov 2026): withPrice makes the section with its first real change.
  return `---\n${front.join('\n')}\n---\n## Notes\n\n`;
}

/** A bill's words with a new price added to its history (the old one recorded first when the history is empty). Its
 *  `amount:` property is set by the caller (the app's property writer). */
export function withPrice(content: string, from: number | null, to: number, date: string, note = 'Price changed'): string {
  const history = priceHistory(content);
  const rows = [...(history.length || from === null ? [] : [`| | ${from.toFixed(2)} | Before |`]), `| ${date} | ${to.toFixed(2)} | ${cell(note)} |`];
  const at = /^#{2,3}\s+price history\s*$/im.exec(content);
  if (!at) return `${content.replace(/\s*$/, '')}\n\n## Price history\n\n| Date | Amount | Note |\n| --- | --- | --- |\n${rows.join('\n')}\n`;
  const lines = content.split(/\r?\n/);
  const start = content.slice(0, at.index).split(/\r?\n/).length - 1;
  let end = start + 1;
  let lastRow = -1;
  for (; end < lines.length && !/^#{1,3}\s/.test(lines[end]); end++) if (/^\s*\|.*\|\s*$/.test(lines[end])) lastRow = end;
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  if (lastRow < 0) {
    lines.splice(start + 1, 0, '', '| Date | Amount | Note |', '| --- | --- | --- |', ...rows);
    return lines.join(eol);
  }
  lines.splice(lastRow + 1, 0, ...rows);
  return lines.join(eol);
}

export const SPEND_HEAD = ['Date', 'What', 'Category', 'Amount', 'Account', 'Receipt'];

/** A new Spending month note's words. */
export function newSpendingText(month: string): string {
  return `---\ntype: spending-month\nmonth: ${month}\n---\n## Spending\n\n| ${SPEND_HEAD.join(' | ')} |\n| ${SPEND_HEAD.map(() => '---').join(' | ')} |\n`;
}

export interface SpendInput {
  date: string;
  what: string;
  category: string;
  amount: number;
  account?: string;
  receipt?: string;
}

/** A Spending month's words with rows added to its table, every row in date order (the person's own rows keep their
 *  words; only the order of the new ones among them is chosen). */
export function withSpendRows(content: string, rows: SpendInput[]): string {
  const lines = content.replace(/\s*$/, '').split(/\r?\n/);
  const head = lines.findIndex((l) => /^\s*\|\s*date\s*\|/i.test(l));
  const line = (r: SpendInput) => `| ${r.date} | ${cell(r.what)} | ${cell(r.category)} | ${r.amount.toFixed(2)} | ${cell(accountCellOf(r.account ?? ''))} | ${cell(r.receipt ?? '')} |`;
  // One identity everywhere (9.2): a row already there (same day, amount, merchant words) is never added again.
  const keyOfLine = (l: string) => {
    const c = l.split('|').map((x) => x.trim());
    const d = readIsoDay(c[1]);
    const a = readMoney(c[4]);
    return d && a !== null ? spendDedupeKey(d, a, c[2] ?? '') : null;
  };
  if (head < 0) return `${lines.join('\n')}\n\n## Spending\n\n| ${SPEND_HEAD.join(' | ')} |\n| ${SPEND_HEAD.map(() => '---').join(' | ')} |\n${rows.map(line).join('\n')}\n`;
  let end = head + 2;
  while (end < lines.length && /^\s*\|.*\|\s*$/.test(lines[end])) end++;
  const existing = lines.slice(head + 2, end);
  const have = new Map<string, number>();
  for (const k of existing.map(keyOfLine).filter(Boolean)) have.set(k as string, (have.get(k as string) ?? 0) + 1);
  const seen = new Map<string, number>();
  rows = rows.filter((r) => {
    const k = spendDedupeKey(r.date, r.amount, r.what);
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    return n > (have.get(k) ?? 0);
  });
  const dateOfLine = (l: string) => readIsoDay(l.split('|')[1]?.trim()) ?? '';
  const merged = [...existing.map((l) => ({ l, d: dateOfLine(l), old: true })), ...rows.map((r) => ({ l: line(r), d: r.date, old: false }))];
  merged.sort((a, b) => a.d.localeCompare(b.d));
  lines.splice(head + 2, existing.length, ...merged.map((x) => x.l));
  return `${lines.join('\n')}\n`;
}

/** A new Budget note's words. */
export function newBudgetText(amount: number | null, period = 'Monthly'): string {
  return `---\ntype: budget-category\namount: ${amount === null ? '' : amount.toFixed(2)}\nperiod: ${period}\n---\n`.replace(/amount: \n/, 'amount:\n');
}

/** A new Account note's words (its number is a locked link, made by the caller in Secrets, or nothing). */
export function newAccountText(a: { institution?: string; kind?: string; holder?: string; number?: string; balance?: number | null }): string {
  const front = ['type: bank-account', `institution: ${yamlWords(a.institution ?? '')}`, `kind: ${yamlWords(a.kind ?? 'Everyday')}`, `holder: ${yamlWords(a.holder ?? '')}`, a.number ? `number: ${JSON.stringify(a.number)}` : 'number:', `balance: ${a.balance === null || a.balance === undefined ? '' : a.balance.toFixed(2)}`, 'as_of:'];
  return `---\n${front.map((l) => l.replace(/: ""$/, ':').trimEnd()).join('\n')}\n---\n## Notes\n\nLogins and numbers are kept in Secrets, never here.\n`;
}

// ── Categories ───────────────────────────────────────────────────────────────────────────────────────────────────────
// The usual words for each category, so an imported row gets a sensible one before the person has taught it anything.
// The person's own past choices win (a merchant categorised once is categorised that way again).

const CATEGORY_WORDS: [RegExp, string][] = [
  [/\b(woolworths|woolies|coles|aldi|iga|foodworks|harris farm|costco|supermarket|grocer|butcher|bakery|fruit)\b/i, 'Groceries'],
  [/\b(cafe|caf[eé]|coffee|restaurant|bistro|pizza|sushi|mcdonald'?s?|kfc|hungry jack'?s|subway|grill|bar\b|pub\b|uber ?eats|doordash|menulog|deliveroo|takeaway)\b/i, 'Eating out'],
  [/\b(bp|shell|caltex|ampol|7-?eleven|united petrol|puma energy|fuel|petrol|metro petroleum)\b/i, 'Fuel'],
  [/\b(uber(?! ?eats)|didi|ola\b|taxi|opal|myki|go ?card|translink|transport|parking|toll|linkt|e-?toll|citylink)\b/i, 'Transport'],
  [/\b(agl|origin|energy ?australia|red energy|alinta|simply energy|powershop|electric|water|gas\b|council rates|sydney water|yarra valley)\b/i, 'Home and utilities'],
  [/\b(telstra|optus|vodafone|tpg|aussie ?broadband|iinet|belong|amaysim|boost mobile|internet|nbn|superloop|dodo)\b/i, 'Phone and internet'],
  [/\b(netflix|spotify|disney|stan\b|kayo|foxtel|binge|youtube|apple\.com|itunes|google ?(?:storage|one|play)|microsoft ?365|adobe|patreon|audible|paramount|prime video|amazon prime|dropbox|icloud|openai|chatgpt|subscription|membership)\b/i, 'Subscriptions'],
  [/\b(insurance|insure|nrma|aami|allianz|budget direct|youi|qbe|suncorp|racv|bupa|medibank|nib|hcf|ahm)\b/i, 'Insurance'],
  [/\b(rent|mortgage|home loan|real estate|strata)\b/i, 'Rent or mortgage'],
  [/\b(chemist|pharmacy|priceline|medical|doctor|gp\b|dental|dentist|physio|pathology|hospital|optometrist|specsavers)\b/i, 'Health'],
  [/\b(amazon|kmart|target|big w|jb ?hi-?fi|harvey norman|officeworks|bunnings|ikea|myer|david jones|ebay|the good guys|catch\.com)\b/i, 'Shopping'],
  [/\b(cinema|hoyts|event cinemas|village|steam|playstation|xbox|nintendo|ticketek|ticketmaster|concert|museum|zoo)\b/i, 'Entertainment'],
  [/\b(school|tafe|university|uni\b|tuition|course|udemy|coursera)\b/i, 'Education'],
  [/\b(qantas|virgin|jetstar|airbnb|booking\.com|hotel|motel|expedia|airline|flight)\b/i, 'Travel'],
  [/\b(fee|interest|charge|overdrawn|international transaction)\b/i, 'Fees and interest'],
];

/** A merchant's key: its description without card numbers, dates, places and reference numbers ("WOOLWORTHS 1234 SYDNEY
 *  NS AUS Card xx1234" → "woolworths"). */
export function merchantKey(what: string): string {
  return String(what ?? '')
    .toLowerCase()
    .replace(/\b(card|value date|ref|reference|receipt|eftpos|visa|mastercard|debit|purchase|pos|aus|au|nsw|vic|qld|wa|sa|tas|nt|act|ns|xx+\d*)\b/g, ' ')
    .replace(/https?:\/\/\S+|www\.\S+/g, ' ')
    .replace(/\.(com|net|org)(\.au)?\b/g, ' ')
    .replace(/\b(subscription|membership|payment|direct debit|dd|bpay|pty|ltd|limited|online|recurring)\b/g, ' ')
    .replace(/\d{1,2}[/.-]\d{1,2}([/.-]\d{2,4})?/g, ' ')
    .replace(/[#*]?\d+/g, ' ')
    .replace(/[^a-z&' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, 3)
    .join(' ');
}

/** One payment's identity everywhere (9.2): the bank import and Mark paid share it, so a retry, a double mark or a
 *  later import never doubles a row. Its day, amount and merchant words. */
export function spendDedupeKey(date: string, amount: number, what: string): string {
  return `${date}|${amount.toFixed(2)}|${merchantKey(what)}`;
}

/** The category for a row: the person's own exact choice for that merchant before, else what makes it different
 *  from a merchant it extends ("WOOLWORTHS PETROL" is Fuel for its petrol, 9.2), else their choice for the merchant
 *  it extends ("woolworths metro" learns Groceries from "woolworths"), else the usual words, else Other. */
export function guessCategory(what: string, learned: ReadonlyMap<string, string> = new Map()): string {
  const key = merchantKey(what);
  if (key && learned.has(key)) return learned.get(key)!;
  // The longest known merchant it starts with, on a word break only ("woolworths metro" extends "woolworths";
  // "woolworthsx" extends nothing).
  let stem = '';
  for (const k of learned.keys()) {
    if (k && k.length > stem.length && key.startsWith(k) && /^[\s&']/.test(key.slice(k.length))) stem = k;
  }
  const rest = stem ? key.slice(stem.length) : '';
  const specific = rest ? CATEGORY_WORDS.find(([re]) => re.test(rest))?.[1] : undefined;
  if (specific) return specific;
  if (stem) return learned.get(stem)!;
  return CATEGORY_WORDS.find(([re]) => re.test(what))?.[1] ?? 'Other';
}

/** What the person has chosen for each merchant before (the latest choice wins). */
export function learnedCategories(spending: readonly Spend[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const s of spending) if (s.category && s.category !== 'Other') out.set(merchantKey(s.what), s.category);
  return out;
}

export const CATEGORIES = SPEND_CATEGORIES;

// ── A bank's CSV ─────────────────────────────────────────────────────────────────────────────────────────────────────

export interface ImportRow {
  date: string;
  what: string;
  amount: number;
  category: string;
  /** Already in a Spending month (the same day, amount and words). */
  duplicate: boolean;
  /** The bill it pays, when its words name one. */
  bill?: string;
}

export interface BillSuggestion {
  name: string;
  amount: number;
  cycle: string;
  next: string;
  category: string;
  /** In words: "Charged on 3 Sep, 3 Oct and 3 Nov". */
  why: string;
}

export interface PriceChangeSuggestion {
  bill: string;
  name: string;
  from: number;
  to: number;
  date: string;
}

export interface ImportPlan {
  rows: ImportRow[];
  /** Money that came in (pay, refunds), left out. */
  moneyIn: number;
  /** How the columns were read, in words ("Date, Description, Debit and Credit"). */
  read: string;
  /** The columns came from what this bank's files used last time (remembered in the vault). */
  remembered?: boolean;
  /** The remembered-columns key for this file's header, when it has one. */
  profileKey?: string;
  newBills: BillSuggestion[];
  priceChanges: PriceChangeSuggestion[];
  /** Bills a row paid, with the latest day each was paid. */
  paid: { bill: string; date: string }[];
  /** Why nothing could be read, in plain words. */
  problem?: string;
}

const isDateCell = (s: string) => !!readIsoDay(s) || !!readIsoDay(s, 'mdy');
const isMoneyCell = (s: string) => /^\s*[-+(]?\s*[$€£]?\s*-?\d[\d,]*(\.\d{1,2})?\s*\)?\s*(CR|DR)?\s*$/i.test(s) && readMoney(s.replace(/\s*(CR|DR)\s*$/i, '')) !== null;

export type BankColumns = { header: boolean; date: number; what: number; amount: number; debit: number; credit: number; category: number; order: 'dmy' | 'mdy' };
/** One bank's columns as remembered in the vault (module-options.json), keyed by its files' header words. */
export type BankProfiles = Record<string, Omit<BankColumns, 'header'>>;

/** A bank file's remembered-columns key: its header words, tidied ('' when it has no header row to remember). */
export function bankProfileKey(table: string[][]): string {
  if (!table.length) return '';
  const first = table[0].map((c) => c.trim().toLowerCase());
  const header = first.some((c) => /^(date|transaction date|posted|description|narrative|details|amount|debit|credit|payee|merchant|memo)/.test(c)) && !first.some((c) => isDateCell(c));
  return header ? first.join('|').slice(0, 300) : '';
}

/** The profiles as kept: only well-formed ones, at most 20 banks. */
export function cleanBankProfiles(raw: unknown): BankProfiles {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: BankProfiles = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>).slice(0, 20)) {
    if (!k || !v || typeof v !== 'object') continue;
    const p = v as Record<string, unknown>;
    const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x >= -1 && x < 64 ? Math.round(x) : -1);
    const cols = { date: n(p.date), what: n(p.what), amount: n(p.amount), debit: n(p.debit), credit: n(p.credit), category: n(p.category), order: (p.order === 'mdy' ? 'mdy' : 'dmy') as 'dmy' | 'mdy' };
    if (cols.date >= 0 && cols.what >= 0 && (cols.amount >= 0 || cols.debit >= 0)) out[k.slice(0, 300)] = cols;
  }
  return out;
}

/** The profiles with this file's columns remembered for its bank (its header's key). Unchanged without a header. */
export function withBankProfile(profiles: BankProfiles | undefined, table: string[][], cols: BankColumns): BankProfiles {
  const key = bankProfileKey(table);
  const out = cleanBankProfiles(profiles ?? {});
  if (!key) return out;
  const { header: _header, ...rest } = cols;
  out[key] = rest;
  return Object.fromEntries(Object.entries(out).slice(-20));
}

/** Which columns of a bank export are which: remembered for this bank's header when there are any, else read from
 *  the header's words or, with no header, from the values' shapes. */
export function bankColumns(table: string[][], profiles?: BankProfiles): BankColumns | null {
  const key = bankProfileKey(table);
  const remembered = key ? cleanBankProfiles(profiles ?? {})[key] : undefined;
  if (remembered) return { header: true, ...remembered };
  return bankColumnsInferred(table);
}

function bankColumnsInferred(table: string[][]): BankColumns | null {
  if (!table.length) return null;
  const first = table[0].map((c) => c.trim().toLowerCase());
  const header = first.some((c) => /^(date|transaction date|posted|description|narrative|details|amount|debit|credit|payee|merchant|memo)/.test(c)) && !first.some((c) => isDateCell(c));
  const body = header ? table.slice(1) : table;
  if (!body.length) return null;
  const find = (re: RegExp) => (header ? first.findIndex((c) => re.test(c)) : -1);
  let date = find(/^(transaction )?date|^posted|^effective/);
  let what = find(/description|narrative|details|payee|merchant|memo|particulars|transaction$/);
  let amount = find(/^amount|^value|^net/);
  const debit = find(/debit|withdrawal|money out|paid out|spent/);
  const credit = find(/credit|deposit|money in|paid in|received/);
  const category = find(/^category/);
  const cols = Math.max(...body.map((r) => r.length));
  const share = (i: number, test: (s: string) => boolean) => body.filter((r) => r[i] !== undefined && r[i].trim() && test(r[i].trim())).length / body.length;
  if (date < 0) for (let i = 0; i < cols && date < 0; i++) if (share(i, isDateCell) > 0.8) date = i;
  if (amount < 0 && debit < 0) {
    // The first money column that isn't the running balance (a balance never goes negative on most rows; the amount
    // has both signs, or is the first money column).
    const money = [...Array(cols).keys()].filter((i) => i !== date && share(i, isMoneyCell) > 0.8);
    amount = money.find((i) => share(i, (s) => /-|\(|DR/i.test(s)) > 0.05) ?? money[0] ?? -1;
  }
  if (what < 0) {
    let best = -1;
    let len = 0;
    for (let i = 0; i < cols; i++) {
      if (i === date || i === amount || i === debit || i === credit) continue;
      const avg = body.reduce((s, r) => s + (r[i]?.length ?? 0), 0) / body.length;
      if (avg > len && share(i, (s) => /[a-z]/i.test(s)) > 0.6) {
        best = i;
        len = avg;
      }
    }
    what = best;
  }
  if (date < 0 || what < 0 || (amount < 0 && debit < 0)) return null;
  // Day before month unless a value can only be month first (a "day" above 12 in the second place).
  const dates = body.map((r) => r[date]?.trim() ?? '');
  const mdy = dates.some((d) => /^\d{1,2}[/.-](\d{1,2})[/.-]/.test(d) && Number(/^\d{1,2}[/.-](\d{1,2})/.exec(d)![1]) > 12) && !dates.some((d) => /^(\d{1,2})[/.-]/.test(d) && Number(/^(\d{1,2})/.exec(d)![1]) > 12);
  return { header, date, what, amount, debit, credit, category, order: mdy ? 'mdy' : 'dmy' };
}

const nameOfMerchant = (what: string) => {
  const k = merchantKey(what);
  return k ? k.replace(/\b\w/g, (c) => c.toUpperCase()) : what.slice(0, 40);
};

/** Words that link a row to a bill: the bill's name's main words appear in the row's words. The most specific
 *  match wins (more of the name's words, then the longer name); an exact tie links to no bill rather than the
 *  wrong one (9.2 fresh eyes: first-match marked the wrong bill paid). A bank row carrying only the distinctive
 *  words links too ("CREDIT CARD AUTOPAY" is Harbour Credit Card when no other bill shares those words; 9.5, 2 Nov 2026). */
function billFor(what: string, bills: readonly Bill[]): Bill | undefined {
  const hay = ` ${what.toLowerCase().replace(/[^a-z0-9&]+/g, ' ')} `;
  const STOP = ['bill', 'the', 'and', 'subscription', 'plan', 'monthly', 'yearly', 'home'];
  const wordsOf = (n: string) => n.toLowerCase().replace(/[^a-z0-9&]+/g, ' ').split(' ').filter((w) => w.length > 2 && !STOP.includes(w));
  const lists = bills.map((b) => ({ bill: b, all: [b.name, ...(b.names ?? [])].map(wordsOf) }));
  let best: { bill: Bill; words: number } | undefined;
  let tied = false;
  for (const { bill: b, all } of lists) {
    const words = all.filter((ws) => ws.length && ws.every((w) => hay.includes(` ${w} `))).sort((a, c) => c.length - a.length)[0];
    if (!words) continue;
    if (!best || words.length > best.words || (words.length === best.words && b.name.length > best.bill.name.length)) {
      best = { bill: b, words: words.length };
      tied = false;
    } else if (words.length === best.words && b.name.length === best.bill.name.length) tied = true;
  }
  if (tied || best) return tied ? undefined : best?.bill;
  // No name wholly in the row: the one bill whose distinctive words the row carries (no other bill's name shares
  // them). A tie — two bills' best subsets the same length — links nothing, as above.
  const scored: { bill: Bill; words: number }[] = [];
  for (const { bill: b, all } of lists) {
    const present = all.map((ws) => ws.filter((w) => hay.includes(` ${w} `))).filter((p) => p.length).sort((a, c) => c.length - a.length)[0];
    if (!present) continue;
    if (lists.some((o) => o.bill !== b && o.all.some((ws) => present.every((w) => ws.includes(w))))) continue;
    scored.push({ bill: b, words: present.length });
  }
  scored.sort((a, c) => c.words - a.words);
  if (!scored.length || (scored.length > 1 && scored[0].words === scored[1].words)) return undefined;
  return scored[0].bill;
}

/**
 * A bank's CSV read into what it would add: each money-out row with a category (the person's own past choices first),
 * rows already kept marked as such, the bills those rows paid (and any whose price changed), and payments that come
 * round regularly but aren't a bill yet (suggested as new bills).
 */
export function planBankImport(table: string[][], model: Pick<FinanceModel, 'bills' | 'spending'>, today: Date = new Date(), profiles?: BankProfiles): ImportPlan {
  const empty: ImportPlan = { rows: [], moneyIn: 0, read: '', newBills: [], priceChanges: [], paid: [] };
  const profileKey = bankProfileKey(table);
  const remembered = !!profileKey && !!cleanBankProfiles(profiles ?? {})[profileKey];
  const c = bankColumns(table, profiles);
  if (!c) return { ...empty, problem: 'That file doesn’t look like a bank export: no column of dates, words and amounts was found. Export transactions as CSV from your bank’s website and try that file.' };
  const body = c.header ? table.slice(1) : table;
  const learned = learnedCategories(model.spending);
  const kept = new Set(model.spending.map((s) => spendDedupeKey(s.date, s.amount, s.what)));
  const rows: ImportRow[] = [];
  let moneyIn = 0;
  for (const r of body) {
    const date = readIsoDay(r[c.date], c.order);
    const what = (r[c.what] ?? '').trim().replace(/\s+/g, ' ');
    if (!date || !what) continue;
    let out: number | null = null;
    if (c.amount >= 0) {
      const raw = (r[c.amount] ?? '').trim();
      const n = readMoney(raw.replace(/\s*(CR|DR)\s*$/i, ''));
      if (n === null) continue;
      const signed = /CR\s*$/i.test(raw) ? Math.abs(n) : /DR\s*$/i.test(raw) ? -Math.abs(n) : n;
      // Most banks write money out as negative; one with only positive amounts and a Debit word is read by that.
      // Money in from a merchant already spent with is a refund (2 Nov 2026, money parity F3): filed negative,
      // netting its purchase; other money in (pay) is left out.
      if (signed < 0) out = -signed;
      else if (learned.has(merchantKey(what))) out = -Math.abs(signed);
      else {
        moneyIn++;
        continue;
      }
    } else {
      const d = readMoney(r[c.debit]);
      const cr = readMoney(r[c.credit]);
      if (d !== null && d !== 0) out = Math.abs(d);
      else if (cr !== null && cr !== 0 && learned.has(merchantKey(what))) out = -Math.abs(cr);
      else {
        if (cr !== null && cr !== 0) moneyIn++;
        continue;
      }
    }
    const isRefund = out < 0;
    const bill = isRefund ? undefined : billFor(what, model.bills);
    const fromFile = c.category >= 0 ? (r[c.category] ?? '').trim() : '';
    const fromFileCat = fromFile && fromFile.length <= 40 && fromFile.toLowerCase() !== 'refunds' ? fromFile : '';
    const category = bill ? spendCategoryOfBill(bill.category) : learned.get(merchantKey(what)) ?? (fromFileCat || guessCategory(what, learned));
    const key = spendDedupeKey(date, out, what);
    // A bill already paid for this row's occurrence (by hand, then the CSV) is a duplicate even when the bank's
    // words differ from the hand row's (2 Nov 2026, money parity F5: "CREDIT CARD AUTOPAY" vs "Harbour Credit Card").
    const alreadyPaid = bill?.anchor && bill.paid ? occurrenceCoveredBy(bill.anchor, bill.cycle, date) === occurrenceCoveredBy(bill.anchor, bill.cycle, bill.paid) : false;
    rows.push({ date, what, amount: out, category, duplicate: kept.has(key) || !!alreadyPaid, ...(bill ? { bill: bill.path } : {}) });
    kept.add(key);
  }
  if (!rows.length && !moneyIn) return { ...empty, problem: 'No transactions could be read from that file. Check it is your bank’s transaction export (CSV), not a statement summary.' };
  rows.sort((a, b) => a.date.localeCompare(b.date));
  // Bills paid, and prices changed: the latest row for each bill.
  const paid: ImportPlan['paid'] = [];
  const priceChanges: PriceChangeSuggestion[] = [];
  for (const b of model.bills) {
    const mine = rows.filter((r) => r.bill === b.path);
    if (!mine.length) continue;
    const last = mine[mine.length - 1];
    if (!b.paid || last.date > b.paid) paid.push({ bill: b.path, date: last.date });
    if (b.amount !== null && Math.abs(last.amount - b.amount) >= 0.01) priceChanges.push({ bill: b.path, name: b.name, from: b.amount, to: last.amount, date: last.date });
  }
  // Payments that come round: the same merchant, much the same amount, at a steady spacing, at least twice (three times
  // for weekly), not a bill already.
  const groups = new Map<string, ImportRow[]>();
  for (const r of rows) {
    if (r.bill || r.amount < 0) continue;
    const k = merchantKey(r.what);
    if (!k) continue;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const newBills: BillSuggestion[] = [];
  for (const [, list] of groups) {
    if (list.length < 2) continue;
    const gaps = list.slice(1).map((r, i) => daysFrom(list[i].date, r.date)).filter((g) => g > 0);
    if (!gaps.length) continue;
    const avg = gaps.reduce((s, g) => s + g, 0) / gaps.length;
    const steady = gaps.every((g) => Math.abs(g - avg) <= Math.max(3, avg * 0.15));
    const amounts = list.map((r) => r.amount);
    const last = list[list.length - 1];
    const similar = amounts.every((a) => Math.abs(a - last.amount) <= Math.max(1, last.amount * 0.15));
    if (!steady || !similar) continue;
    const cycle = avg <= 9 ? 'Weekly' : avg <= 18 ? 'Fortnightly' : avg <= 40 ? 'Monthly' : avg <= 100 ? 'Quarterly' : avg <= 200 ? 'Half-yearly' : 'Yearly';
    if (cycle === 'Weekly' && list.length < 3) continue;
    const next = firstOnOrAfter(last.date, cycle, isoOf(today));
    const days = list.slice(-3).map((r) => dueWords(r.date, isoOf(today)).replace(/^\w+ /, ''));
    const category = last.category === 'Subscriptions' ? 'Subscriptions' : billCategoryOf(last.category);
    newBills.push({ name: nameOfMerchant(last.what), amount: last.amount, cycle, next, category, why: `${cycle} · charged on ${days.join(', ')}` });
  }
  const shown = [c.date, c.what, ...(c.amount >= 0 ? [c.amount] : [c.debit, c.credit])].filter((i) => i >= 0);
  const head = c.header ? table[0] : null;
  const read = head ? shown.map((i) => head[i].trim()).join(', ') : 'dates, words and amounts (no header row)';
  return { rows, moneyIn, read, newBills, priceChanges, paid, ...(remembered ? { remembered: true } : {}), ...(profileKey ? { profileKey } : {}) };
}

/** Whether paying a bill of this category moves money between the person's own accounts (a card or loan repayment),
 *  which is never spending: the purchases on the card already are (9.2: a card repayment logged a
 *  $150 Fees-and-interest spend row — double counting). Mortgages stay spending: without a principal/interest split
 *  the interest would vanish. */
export function isTransferBill(category: string): boolean {
  return /loan|card/i.test(category ?? '');
}

/** A bill's category as a spending category (most share their name; a card or loan repayment is a transfer). */
export function spendCategoryOfBill(cat: string): string {
  if ((SPEND_CATEGORIES as readonly string[]).includes(cat)) return cat;
  if (isTransferBill(cat)) return TRANSFERS_CATEGORY;
  return 'Other';
}
function billCategoryOf(spend: string): string {
  const map: Record<string, string> = { 'Home and utilities': 'Home and utilities', 'Phone and internet': 'Phone and internet', Subscriptions: 'Subscriptions', Insurance: 'Insurance', 'Rent or mortgage': 'Rent or mortgage', Transport: 'Transport', Fuel: 'Transport', Health: 'Health', Education: 'Education' };
  return map[spend] ?? 'Other';
}

// ── A bill from words (an email in the Inbox, a line captured from Telegram) ─────────────────────────────────────────

export interface BillFromWords {
  name: string;
  amount: number;
  due: string | null;
}

const BILL_CUES = /\b(bill|invoice|statement|amount due|payment due|due date|due (?:on|by|\d)|renew(?:s|al)?|subscription|direct debit|account summary|to pay|autopay|auto ?pay|repayment|minimum (?:payment|due|amount)|total due|balance due|new charges|payment of)\b/i;

/**
 * A bill read from a few words: an amount in any currency and words that say it is a bill, invoice, autopay or
 * repayment, with who it is from and the day it is due when they say so ("Your Harbour Internet bill of $89.00 is
 * due on 3 Nov 2026", "Credit Card autopay $200 on 3 Nov"). Null when the words aren't a bill (an amount alone never
 * is, and neither is a bill word with no amount).
 */
export function billFromWords(words: string, today: Date = new Date()): BillFromWords | null {
  const w = String(words ?? '').replace(/\s+/g, ' ').trim();
  if (!BILL_CUES.test(w)) return null;
  const money = /(?:A?\$|AUD|USD|EUR|GBP|NZD|CAD|€|£|¥|₹)\s?(\d[\d,]*(?:\.\d{2})?)|\b(\d[\d,]*\.\d{2})\b/i.exec(w);
  if (!money) return null;
  const amount = readMoney(money[1] ?? money[2]);
  if (amount === null || amount <= 0) return null;
  // Who: "from X", "X bill", "your X invoice", the words before "bill"/"invoice".
  let name = '';
  const from = /\bfrom\s+([A-Z][\w&'.-]*(?:\s+[A-Z][\w&'.-]*){0,3})/.exec(w);
  const before = /(?:your|the|new)\s+([A-Z][\w&'.-]*(?:\s+[A-Z][\w&'.-]*){0,3})\s+(?:bill|invoice|statement|subscription|account)/i.exec(w) ?? /([A-Z][\w&'.-]*(?:\s+[A-Z][\w&'.-]*){0,3})\s+(?:bill|invoice|statement)/.exec(w);
  name = (before?.[1] ?? from?.[1] ?? '').trim();
  if (!name) name = w.replace(money[0], '').split(/\s+/).filter((x) => /^[A-Z]/.test(x)).slice(0, 2).join(' ');
  name = name.replace(/^(your|the|new|a)\s+/i, '').replace(/[.,:;]+$/, '').trim() || 'New bill';
  // When: a day after "due", "by", "on", or any day in the words.
  const at = /\b(?:due|by|on|before)\s+(?:on\s+)?((?:\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})|(?:\d{4}-\d{2}-\d{2})|(?:(?:[a-z]{3,9},?\s+)?\d{1,2}(?:st|nd|rd|th)?\s+[a-z]{3,9}\.?(?:,?\s+\d{4})?)|(?:[a-z]{3,9}\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?))/i.exec(w);
  let due: string | null = null;
  if (at) {
    due = readIsoDay(at[1]);
    if (!due) {
      // A day with no year: the next one from today.
      const m = /(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})/i.exec(at[1]) ?? null;
      const m2 = /([a-z]{3,9})\s+(\d{1,2})/i.exec(at[1]);
      const day = m ? Number(m[1]) : m2 ? Number(m2[2]) : 0;
      const mon = MONTH_WORDS.indexOf((m ? m[2] : m2?.[1] ?? '').slice(0, 3).toLowerCase());
      if (day && mon >= 0) {
        let d = new Date(today.getFullYear(), mon, day);
        if (isoOf(d) < isoOf(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 31))) d = new Date(today.getFullYear() + 1, mon, day);
        due = isoOf(d);
      }
    }
  }
  return { name: name.slice(0, 60), amount, due };
}

// ── Bills on their project (10.0 v2money) ──────────────────────────────────────────────────────────────────────────

/** The bills belonging to one project, by its name or path (link, path or plain words, any case). */
export function billsForProject(bills: readonly Bill[], ref: string): Bill[] {
  const want = linkName(ref).toLowerCase();
  if (!want) return [];
  const base = want.split('/').pop()!.replace(/\.md$/i, '');
  return bills.filter((b) => {
    const p = (b.project ?? '').toLowerCase();
    if (!p) return false;
    const pb = p.split('/').pop()!;
    return p === want || pb === base || pb === want || p === base;
  });
}

/** A project's bills as its Money tab heads them: still due first (soonest first, undated last), then the paid and
 *  paused; what the due ones cost a month together; and how many are overdue. */
export function projectMoneySummary(bills: readonly Bill[]): { due: Bill[]; rest: Bill[]; monthly: number; overdue: number } {
  const due = bills.filter((b) => b.next !== null).sort((a, b) => (a.days ?? 1e9) - (b.days ?? 1e9));
  const rest = bills.filter((b) => b.next === null);
  return { due, rest, monthly: due.reduce((s, b) => s + (b.monthly ?? 0), 0), overdue: due.filter((b) => b.overdue).length };
}

// ── Spending well over usual (10.0 v2money: the brief and the bell warn early) ────────────────────────────────────

export interface OverUsual {
  category: string;
  /** This month so far. */
  spent: number;
  /** The mean over the prior months it appears in. */
  usual: number;
  /** How many prior months set the usual. */
  months: number;
  month: string;
}

/** How far over usual counts as well over: at least half as much again, and at least this far in money. */
export const OVER_USUAL_RATIO = 1.5;
export const OVER_USUAL_MIN_ABOVE = 50;
export const OVER_USUAL_MIN_USUAL = 20;

/** Categories this month well over their usual: the mean of up to three prior months, Transfers never. Needs the
 *  category in at least two prior months, so a new kind of spending never warns on one month. */
export function spendingOverUsual(model: Pick<FinanceModel, 'months' | 'thisMonth'>): OverUsual[] {
  const now = model.months.find((m) => m.month === model.thisMonth);
  if (!now) return [];
  const prior = model.months.filter((m) => m.month < model.thisMonth).slice(-3);
  const out: OverUsual[] = [];
  for (const [category, spent] of Object.entries(now.byCategory)) {
    if (category === TRANSFERS_CATEGORY || !(spent > 0)) continue;
    const had = prior.map((m) => m.byCategory[category] ?? 0).filter((v) => v > 0);
    if (had.length < 2) continue;
    const usual = Math.round((had.reduce((s, v) => s + v, 0) / had.length) * 100) / 100;
    if (!(usual >= OVER_USUAL_MIN_USUAL)) continue;
    if (spent >= usual * OVER_USUAL_RATIO && spent - usual >= OVER_USUAL_MIN_ABOVE) out.push({ category, spent: Math.round(spent * 100) / 100, usual, months: had.length, month: model.thisMonth });
  }
  return out.sort((a, b) => b.spent - b.usual - (a.spent - a.usual));
}

// ── The early warnings in plain words (10.0 v2money: one wording, the brief and the bell share it) ────────────────
// Plain Australian English, no em dashes. Each returns the title and the detail line.

/** A bill due soon or overdue: its amount, its day, and, when autopay is off, not paid yet with you pay it by hand
 *  (10.0 third round F8, 2 Nov 2026: the old ", paid …" suffix alone read as paid under an "overdue"
 *  title, but by hand is how it is paid, not that it was). */
export function billDueWords(b: Pick<Bill, 'name' | 'amount' | 'next' | 'days' | 'overdue' | 'autopay'>, currency: string, today: string): { title: string; detail: string } {
  const amount = b.amount !== null ? moneyWords(b.amount, currency) : 'No amount written';
  if (b.overdue && b.next) return { title: `${b.name} is overdue`, detail: `${amount} was due ${dueWords(b.next, today)}${b.autopay ? ' (autopay, not confirmed)' : ', not paid yet; you pay it by hand'}` };
  if (b.next && b.days !== null) {
    const when = b.days === 0 ? 'due today' : b.days === 1 ? 'due tomorrow' : `due in ${b.days} days`;
    return { title: `${b.name} is ${when}`, detail: `${amount} on ${dueWords(b.next, today)}${b.autopay ? ' (autopay)' : ', you pay it by hand'}` };
  }
  return { title: b.name, detail: amount };
}

/** Spending in a category well over its usual, with both figures so the person can judge. */
export function spendOverWords(o: OverUsual, currency: string): { title: string; detail: string } {
  return { title: `${o.category} is well above usual`, detail: `${moneyWords(o.spent, currency)} so far in ${monthWords(o.month)}, usually about ${moneyWords(o.usual, currency)}` };
}

/** A price that went up (a rise only: a fall is good news, said on the Money page, never pushed). */
export function priceUpWords(b: Pick<Bill, 'name' | 'change'>, currency: string, today: string): { title: string; detail: string } | null {
  if (!b.change || b.change.to <= b.change.from) return null;
  return { title: `${b.name} went up`, detail: `${moneyWords(b.change.from, currency)} to ${moneyWords(b.change.to, currency)}${b.change.date ? ` from ${dueWords(b.change.date, today)}` : ''}` };
}

export interface TightMonth {
  title: string;
  detail: string;
  /** The tight week's first day (YYYY-MM-DD): the bell says it once per week. */
  week: string;
  /** The biggest bill in the window, to open ('' when none carries its note). */
  path: string;
}

/** One plain sentence for when the next 30 days look tight (`forecast` is the 30-day one): the brief and the bell
 *  share it. Silent when calm and when unknowable (no balance and no pay written: the `affordCheck.known` rule, so
 *  a vault with nothing said never warns). Tight is the lowest end-of-week balance going under (a balance known),
 *  else more going out than coming in (pay known). */
export function tightMonthWords(forecast: FinanceForecast, currency: string, today: string): TightMonth | null {
  if (!(forecast.totalOut > 0)) return null;
  if (forecast.startingBalance === null && !(forecast.totalIn > 0)) return null;
  const path = biggestOut(forecast.events)?.path ?? '';
  if (forecast.startingBalance !== null) {
    const lowest = [...forecast.weeks].sort((a, b) => (a.balance ?? 0) - (b.balance ?? 0))[0];
    if (!lowest || lowest.balance === null || !(lowest.balance < 0)) return null;
    return {
      title: 'The next 30 days look tight',
      detail: `${moneyWords(forecast.totalOut, currency)} going out against ${moneyWords(forecast.totalIn, currency)} coming in. That would leave the balance at ${moneyWords(lowest.balance, currency)} around ${dueWords(lowest.start, today)}.`,
      week: lowest.start,
      path,
    };
  }
  if (!(round2(forecast.totalIn - forecast.totalOut) < 0)) return null;
  return {
    title: 'The next 30 days look tight',
    detail: `${moneyWords(forecast.totalOut, currency)} going out against ${moneyWords(forecast.totalIn, currency)} coming in over the next 30 days.`,
    week: forecast.weeks[0]?.start ?? forecast.from,
    path,
  };
}

// ── A receipt from words (10.0 v2money: a photo or PDF dropped anywhere is read and filed) ─────────────────────────

export interface ReceiptFromWords {
  /** Who was paid, as printed (the receipt's first text line with letters). */
  merchant: string;
  /** The total paid. */
  total: number;
  /** The day on the receipt, or today when none is printed. */
  date: string;
}

const RECEIPT_TOTAL_CUE = /\b(total|balance due|amount due|total due|grand total|amount payable|to pay|eftpos|visa|mastercard|approved)\b/i;

/** A receipt read from its words (OCR from a photo, text from a PDF): merchant, total and day. The total is the
 *  amount on a total line when there is one, else the largest amount printed. Null when no amount reads. */
export function receiptFromWords(words: string, today: Date = new Date()): ReceiptFromWords | null {
  const lines = String(words ?? '').split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (!lines.length) return null;
  const amountsOn = (line: string): number[] => {
    const out: number[] = [];
    for (const m of line.matchAll(/(?:A?\$|AUD|USD|EUR|GBP|NZD|CAD|€|£|¥|₹)?\s?\d[\d,]*(?:\.\d{2})\b/gi)) {
      const n = readMoney(m[0]);
      if (n !== null && n > 0) out.push(n);
    }
    return out;
  };
  let total: number | null = null;
  for (const line of lines) {
    if (!RECEIPT_TOTAL_CUE.test(line)) continue;
    const ns = amountsOn(line);
    if (ns.length) total = Math.max(total ?? 0, ...ns);
  }
  if (total === null) {
    for (const line of lines) for (const n of amountsOn(line)) total = Math.max(total ?? 0, n);
  }
  if (total === null || !(total > 0)) return null;
  const merchant = (lines.find((l) => /[a-z]{2,}/i.test(l) && !/^\d[\d,]*(\.\d{2})?$/.test(l) && l.replace(/[^a-z]/gi, '').length >= 2) ?? 'Receipt').replace(/^[*#>•\-–—]+\s*/, '').slice(0, 60).trim() || 'Receipt';
  let date: string | null = null;
  for (const line of lines) {
    const m = /(\d{4}-\d{2}-\d{2})|(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})|((?:[a-z]{3,9},?\s+)?\d{1,2}(?:st|nd|rd|th)?\s+[a-z]{3,9}\.?(?:,?\s+\d{4})?)/i.exec(line);
    if (m) {
      date = readIsoDay(m[0]) ?? date;
      if (date) break;
    }
  }
  return { merchant, total: Math.round(total * 100) / 100, date: date ?? isoOf(today) };
}

export interface ReceiptBillMatch {
  path: string;
  name: string;
  /** In words: "Same name and amount, due Thu 5 Nov". */
  why: string;
}

/** How far a receipt's total may be from the bill's amount and still be offered (a dollar or a percent for fees and
 *  rounding, whichever is larger), and how near its day to the bill's coming due day. */
export const RECEIPT_BILL_AMOUNT_TOLERANCE = 1;
export const RECEIPT_BILL_DAY_WINDOW = 45;

/**
 * A receipt's bill (10.0 v10money): the open bill its words name, when the amount and the day fit too. The name
 * match is the bank row's one (`billFor`: the most specific name wins, a tie is nothing, never the wrong bill);
 * the amount is the bill's within the tolerance, the day within the window of its coming due. Null when no bill
 * fits, when two fit equally, or when the receipt's occurrence is already paid. An offer, never a filing: the
 * caller names the bill and the person marks it paid.
 */
export function receiptBillMatch(receipt: Pick<ReceiptFromWords, 'merchant' | 'total' | 'date'>, bills: readonly Bill[], today: string): ReceiptBillMatch | null {
  const open = bills.filter((b) => b.next && b.amount !== null && !/^(paused|cancelled|canceled|stopped|ended)$/i.test(b.status));
  if (!open.length) return null;
  const bill = billFor(receipt.merchant, open);
  if (!bill || bill.amount === null || !bill.next) return null;
  if (Math.abs(receipt.total - bill.amount) > Math.max(RECEIPT_BILL_AMOUNT_TOLERANCE, Math.round(bill.amount * 0.01 * 100) / 100)) return null;
  if (Math.abs(daysFrom(receipt.date, bill.next)) > RECEIPT_BILL_DAY_WINDOW) return null;
  if (bill.anchor && bill.paid && occurrenceCoveredBy(bill.anchor, bill.cycle, receipt.date) === occurrenceCoveredBy(bill.anchor, bill.cycle, bill.paid)) return null;
  return { path: bill.path, name: bill.name, why: `Same name and amount, due ${dueWords(bill.next, today)}` };
}

/** A Spending month's words without one payment row (its day, amount and merchant words): the first matching row goes,
 *  the rest byte for byte (10.0 v2money: undoing a filed receipt removes only its row, never a later one). */
export function withoutSpendRow(content: string, date: string, amount: number, what: string): string {
  const want = spendDedupeKey(date, amount, what);
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*\|.*\|\s*$/.test(lines[i])) continue;
    const c = lines[i].split('|').map((x) => x.trim());
    if (/^date$/i.test(c[1] ?? '') || /^---+$/.test(c[1] ?? '')) continue;
    const d = readIsoDay(c[1]);
    const a = readMoney(c[4]);
    if (d && a !== null && spendDedupeKey(d, a, c[2] ?? '') === want) {
      lines.splice(i, 1);
      return lines.join(eol);
    }
  }
  return content;
}
