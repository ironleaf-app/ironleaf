// The agent tools of Finance and Documents and ID (Wave 5, 24 Oct 2026; the rule for every module: "Agents get tools per
// module (e.g. finance_bill_add…) and access per sensitivity level"). Ironleaf's side chat, its outside agents, The
// former host app and a chat bot all use these same definitions and answers (the former host app through
// tools/build-embedded.mjs), so "what bills are due this week?" gets the same answer wherever it is asked.
//
// The answers are made only from the notes the asking agent may read: each caller passes the notes its gate lets through
// (src/main/agent-gate.ts, the former host app's vault-gate.mjs), so an agent not allowed Personal items sees no bill and
// no document, and is told why. A document's number is never in an answer: it is in Secrets, and agents never read
// Secrets. Writes (a new bill, a new document) are planned here as a new note's path and words; each caller writes it its
// own way, through its own gate, and never over a note already there.
//
// Pure: no files, no Node, no DOM.

import { affordCheck, billFromWords, dueWords, financeForecast, financeModel, incomeFromSettings, learnedCategories, merchantKey, monthWords, moneyWords, newAccountText, newBillText, newBudgetText, readCycle, readIsoDay, readMoney, safeFileName, spendDedupeKey, whenWords, type FinanceNote, type IncomeEntry } from './finance';
import { defaultRemindForKind, documentFromReading, documentName, documentsModel, expiryWords, newDocumentText, type DocumentNote, type IdDocument } from './id-documents';
import { BILL_CATEGORIES, BILL_CYCLES, DOCUMENT_KINDS, moduleOfTool, typeFolder } from './module-records';
import { normalizeRef, resolveOne, sameRecordName } from './record-match';
import { frontType } from './sensitivity';
import { plural } from './words';

/** What a bill's category means, as a bookkeeper files it: finance_bill_add's category description and the create
 *  path's refusal when a new bill comes without one (2 Nov 2026: an update was refused for want of it, so one bill took
 *  six calls — the category is only ever needed when the bill is first made). One sentence in one place, so the schema
 *  and the refusal cannot drift apart. */
export const BILL_CATEGORY_DESC =
  'What the bill is, as a bookkeeper files it: a credit card, store card, buy-now-pay-later account or loan is Loans and cards (paying it is a transfer, not spending). Other only when none fits.';

export const RECORD_MODULE_TOOLS = [
  {
    name: 'finance_bills_due',
    module: 'finance',
    write: false,
    description: 'Bills and subscriptions due soon in the person’s Money module (Ironleaf): each with its amount, the day it is due, whether it is overdue, autopay and the account it comes out of, and the total. Use it for "what bills are due this week?", "anything overdue?".',
    parameters: { type: 'object', properties: { days: { type: 'number', description: 'How many days ahead (14 unless given).' } }, additionalProperties: false },
  },
  {
    name: 'finance_bill_list',
    module: 'finance',
    write: false,
    description: 'Every bill and subscription in the Money module: amount, how often, next due day, category, autopay, status, what each costs a month, recent price changes, and what they cost together a month. Use it for "what subscriptions do I have?", "how much do my bills cost a month?", "did Netflix go up?".',
    parameters: { type: 'object', properties: { category: { type: 'string', description: 'Only this category (Subscriptions, Insurance…).' }, query: { type: 'string', description: 'Words in the bill’s name.' }, project: { type: 'string', description: 'Only the bills belonging to this project, by its name.' } }, additionalProperties: false },
  },
  {
    name: 'finance_spending',
    module: 'finance',
    write: false,
    description: 'Money spent in one month (from the bank CSVs imported and receipts added): the total, by category, each budget beside what was spent, and the months before for comparison. Use it for "how much did I spend on groceries this month?", "am I over budget?".',
    parameters: { type: 'object', properties: { month: { type: 'string', description: 'YYYY-MM (this month unless given).' }, category: { type: 'string', description: 'Only this category, with its rows.' } }, additionalProperties: false },
  },
  {
    name: 'finance_bill_add',
    module: 'finance',
    write: true,
    description: 'Add a bill or subscription to the Money module: its name, amount, how often it comes round and a day it is due, with the project it belongs to when they name one. Give every field known in the one call. Check finance_bill_list first and name it as the list gives it: when the bill is already there it is updated in place (its new amount, day — the category is only needed when it is first made), never added again. Use the person’s own words; never guess an amount or a day they didn’t give (leave it out instead). Account numbers and logins never go in a bill.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Who it is to, as the person says it ("Harbour Internet").' },
        amount: { type: 'number', description: 'Each time it is paid.' },
        cycle: { type: 'string', enum: [...BILL_CYCLES], description: 'How often.' },
        due: { type: 'string', description: 'A day it is due, YYYY-MM-DD.' },
        category: { type: 'string', enum: [...BILL_CATEGORIES], description: BILL_CATEGORY_DESC },
        account: { type: 'string', description: 'The account it comes out of, by its name in Money.' },
        project: { type: 'string', description: 'The project it belongs to, by the project’s name (it shows on the project).' },
        autopay: { type: 'boolean', description: 'It is paid automatically.' },
        subscription: { type: 'boolean', description: 'It is a subscription rather than a bill.' },
      },
      required: ['name'],
      additionalProperties: false,
    },
  },
  {
    name: 'finance_bill_mark_paid',
    module: 'finance',
    write: true,
    description: 'Mark a bill or subscription in Money as paid (today unless the person gave the day it was paid), with the account it was paid from when they name one and the amount when they gave it (never guessed: omitted unless the person said it). A card or loan repayment is a transfer, not spending: it is recorded on the bill and as a Transfers row. Any other bill’s payment goes into that month’s spending, the way Mark paid in the window does. Name the bill as finance_bills_due or finance_bill_list gives it.',
    parameters: {
      type: 'object',
      properties: {
        bill: { type: 'string', description: 'The bill’s name.' },
        date: { type: 'string', description: 'The day it was paid, YYYY-MM-DD (today unless given).' },
        account: { type: 'string', description: 'The account it was paid from, by its name in Money (optional).' },
        amount: { type: 'number', description: 'How much was paid, as the person gave it (optional, never guessed).' },
      },
      required: ['bill'],
      additionalProperties: false,
    },
  },
  {
    name: 'finance_forecast',
    module: 'finance',
    write: false,
    description: 'The next 90 days in Money (or the days given): every bill, subscription and renewal on each day it falls, the pay expected (from Money options, or the pay given here), what goes out and comes in each week, the tightest week, and, when an amount is given, whether it fits. Use it for "can we afford the car repair?", "what does the next month look like?". Never guess pay: leave it out when the person has not said.',
    parameters: { type: 'object', properties: { days: { type: 'number', description: 'How many days ahead (90 unless given).' }, amount: { type: 'number', description: 'A new cost to test against the look-ahead.' }, income_name: { type: 'string' }, income_amount: { type: 'number', description: 'Each pay, as the person gave it.' }, income_cycle: { type: 'string', description: 'How often the pay comes (Weekly, Fortnightly, Monthly…).' }, income_next: { type: 'string', description: 'The next pay day, YYYY-MM-DD.' } }, additionalProperties: false },
  },
  {
    name: 'finance_receipt_add',
    module: 'finance',
    write: true,
    description: 'File a receipt read from a photo or PDF in Money: add its payment (the day, who was paid, the amount and category as read off it) to that month’s spending, with the receipt file named in its row when the file is kept with it. Use only what is printed on the receipt; ask for a day or amount that cannot be read, never guess.',
    parameters: { type: 'object', properties: { date: { type: 'string', description: 'The day paid, YYYY-MM-DD.' }, what: { type: 'string', description: 'Who was paid, as printed.' }, amount: { type: 'number', description: 'The total paid.' }, category: { type: 'string' }, account: { type: 'string', description: 'The account it came from, by its name in Money.' }, receipt: { type: 'string', description: 'The receipt file kept with it, as a vault path or link words.' } }, required: ['date', 'what', 'amount'], additionalProperties: false },
  },
  {
    name: 'finance_account_add',
    module: 'finance',
    write: true,
    description: 'Add an account to Money (the accounts bills come out of): its name, bank or provider, kind and whose it is, and its balance now when given. Never write an account number or login in it: those go in Secrets in the window.',
    parameters: { type: 'object', properties: { name: { type: 'string' }, institution: { type: 'string' }, kind: { type: 'string' }, holder: { type: 'string' }, balance: { type: 'number' } }, required: ['name'], additionalProperties: false },
  },
  {
    name: 'finance_budget_add',
    module: 'finance',
    write: true,
    description: 'Set a budget in Money: how much the person means to spend on one category, and each how often (Monthly unless given).',
    parameters: { type: 'object', properties: { category: { type: 'string' }, amount: { type: 'number' }, period: { type: 'string', enum: ['Monthly', 'Weekly', 'Yearly'] } }, required: ['category', 'amount'], additionalProperties: false },
  },
  {
    name: 'finance_csv_import',
    module: 'finance',
    write: true,
    description: 'Import a bank transactions file (CSV) into Money: each payment filed in its month spending with a category, the bills its rows pay marked paid, prices brought up to date. Give the file path on this PC as handed over with the request. Use it for "import this bank CSV" and a bank file sent with the message. Never ask the person to open the Money window.',
    parameters: { type: 'object', properties: { file: { type: 'string', description: 'The CSV file path on this PC.' }, account: { type: 'string', description: 'The account the file is from, by its name in Money (optional, never guessed).' } }, required: ['file'], additionalProperties: false },
  },
  {
    name: 'document_renewed',
    module: 'documents',
    write: true,
    description: 'Save that a document in Papers was renewed: a new copy is made with the new expiry (and the day it was issued, when given), and the old copy is kept with the renewal noted in it. Name the document as document_list gives it. Its number is never asked for or shown.',
    parameters: { type: 'object', properties: { document: { type: 'string', description: 'The document’s name.' }, expires: { type: 'string', description: 'The new expiry day, YYYY-MM-DD.' }, issued: { type: 'string', description: 'The day the new one was issued, YYYY-MM-DD.' } }, required: ['document', 'expires'], additionalProperties: false },
  },
  {
    name: 'document_expiring',
    module: 'documents',
    write: false,
    description: 'Documents in the person’s Papers module (Ironleaf) that have expired or expire soon: passports, licences, certificates, insurance policies, with whose each is and the day. Use it for "when does my passport expire?", "anything I need to renew?". Numbers are never shown: they are locked in Secrets.',
    parameters: { type: 'object', properties: { days: { type: 'number', description: 'How many days ahead (each document’s own reminder window unless given).' } }, additionalProperties: false },
  },
  {
    name: 'document_list',
    module: 'documents',
    write: false,
    description: 'Every document in Papers: kind, whose, issuer, issued and expiry days, version (CVs) and the files kept with it. Numbers are never shown: they are locked in Secrets, which agents can’t read.',
    parameters: { type: 'object', properties: { kind: { type: 'string', description: 'Only this kind (Passport, Driver licence, Certificate, CV…).' }, holder: { type: 'string', description: 'Only this person’s.' } }, additionalProperties: false },
  },
  {
    name: 'document_add',
    module: 'documents',
    write: true,
    description: 'Add a document to Papers: its kind, whose it is, the issuer and its issued and expiry days, so the person is reminded before it expires. Never put a document number anywhere: the person adds it to Secrets in Ironleaf themselves.',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: [...DOCUMENT_KINDS] },
        holder: { type: 'string', description: 'Whose it is.' },
        issuer: { type: 'string' },
        issued: { type: 'string', description: 'YYYY-MM-DD' },
        expires: { type: 'string', description: 'YYYY-MM-DD' },
        remind: { type: 'number', description: 'Days before it expires to remind (the module’s own unless given).' },
        version: { type: 'string', description: 'A CV’s version ("v3").' },
      },
      required: ['kind'],
      additionalProperties: false,
    },
  },
] as const;

export type RecordModuleToolName = (typeof RECORD_MODULE_TOOLS)[number]['name'];
export const RECORD_MODULE_TOOL_NAMES: string[] = RECORD_MODULE_TOOLS.map((t) => t.name);
export const isRecordModuleTool = (name: string) => RECORD_MODULE_TOOL_NAMES.includes(name);

/** What a tool's answer is made from: the notes of the module's types the asking agent may read. */
export interface ModuleToolInput {
  /** Finance's notes (type: bill, bank-account, budget-category, spending-month) the agent may read. */
  finance: FinanceNote[];
  documents: DocumentNote[];
  /** The ids of the modules that are on. */
  on: readonly string[];
  /** Notes of the module the agent wasn't allowed (so the answer can say so rather than "none"). */
  refused?: { finance: number; documents: number };
  /** The agent's name, for a refusal. */
  agent?: string;
  currency?: string;
  remindDays?: { finance?: number; documents?: number };
  /** Expected pay from Finance's options, for the look-ahead. */
  income?: IncomeEntry[];
  today?: Date;
}

// One plural rule everywhere (3 Nov 2026, fourth-round G5-G7): imported from ./words above.

/** The record `want` names among `items`, by the shared finder (9.2 fresh eyes: adds used to check the exact
 *  tidied name only, so "credit card" made a second bill beside "Harbour Credit Card"). Several matches say so;
 *  generic record nouns ("bill", "account") never block a merge ("Harbour Internet bill" is "Harbour Internet"). */
const GENERIC_NOUNS = new Set(['bill', 'bills', 'account', 'accounts', 'payment', 'payments', 'subscription', 'subscriptions']);
function findKnown<T extends { name: string; path: string; names?: string[] }>(items: readonly T[], want: string, noun: string): T | undefined {
  if (!items.length || !String(want ?? '').trim()) return undefined;
  let hit: T;
  try {
    hit = resolveOne(items, want, { noun, where: 'in Money' });
  } catch (e) {
    if (e instanceof Error && /More than one/.test(e.message)) throw e;
    return undefined;
  }
  const qw = normalizeRef(want).split(/[^a-z0-9]+/).filter(Boolean).filter((w) => !GENERIC_NOUNS.has(w));
  const covered = [hit.name, ...(hit.names ?? [])].some((n) => {
    const nw = normalizeRef(n).split(/[^a-z0-9]+/).filter(Boolean);
    return qw.length > 0 && qw.every((w) => nw.includes(w));
  });
  return covered ? hit : undefined;
}

function offWords(module: string): string {
  return module === 'finance' ? 'The Money module is off in Ironleaf (Settings › Packs). Say so; don’t guess at bills.' : 'The Papers module is off in Ironleaf (Settings › Packs). Say so; don’t guess at documents.';
}
function refusedWords(input: ModuleToolInput, module: 'finance' | 'documents'): string | null {
  const n = input.refused?.[module] ?? 0;
  if (!n) return null;
  return `${plural(n, module === 'finance' ? 'Money record' : 'document')} ${n === 1 ? 'is' : 'are'} marked Personal (or another level) that ${input.agent ?? 'this agent'} isn’t allowed (the person sets this in Ironleaf › Settings › Privacy and secrets). Don’t guess at what ${n === 1 ? 'it says' : 'they say'}.`;
}

/** The answer to one of the read tools, by its name (null: not one of these). */
export function answerRecordModuleTool(input: ModuleToolInput, name: string, args: Record<string, unknown> = {}): string | null {
  const tool = RECORD_MODULE_TOOLS.find((t) => t.name === name);
  if (!tool || tool.write) return null;
  if (!input.on.includes(tool.module)) return offWords(tool.module);
  const today = input.today ?? new Date();
  const cur = input.currency ?? 'AUD';
  const money = (n: number | null) => (n === null ? 'no amount' : moneyWords(n, cur));
  if (tool.module === 'finance') {
    const m = financeModel(input.finance, today);
    const refused = refusedWords(input, 'finance');
    if (name === 'finance_bills_due') {
      const days = typeof args.days === 'number' && args.days > 0 ? Math.min(366, Math.round(args.days)) : 14;
      const due = m.bills.filter((b) => b.next && b.days !== null && b.days <= days).sort((a, b) => a.next!.localeCompare(b.next!));
      if (!due.length) return [`No bills due in the next ${plural(days, 'day')}.`, refused].filter(Boolean).join('\n');
      const total = due.reduce((s, b) => s + (b.amount ?? 0), 0);
      return [
        `${plural(due.length, 'bill')} due in the next ${plural(days, 'day')}, ${money(total)} in all:`,
        ...due.map((b) => `- ${b.name}: ${money(b.amount)} ${b.overdue ? (b.autopay ? `may not have gone through since ${dueWords(b.next!, m.today)} (autopay with no confirmation; check it, or mark it paid)` : `OVERDUE since ${dueWords(b.next!, m.today)}`) : `due ${dueWords(b.next!, m.today)} (${whenWords(b.days!)})`}${b.autopay ? ', autopay' : b.overdue ? ', not paid yet; you pay it by hand' : ', you pay it by hand'}${b.account ? `, from ${b.account}` : ''}${b.project ? `, for ${b.project}` : ''} [${b.path}]`),
        refused,
      ]
        .filter(Boolean)
        .join('\n');
    }
    if (name === 'finance_bill_list') {
      const cat = String(args.category ?? '').trim().toLowerCase();
      const q = String(args.query ?? '').trim().toLowerCase();
      const proj = String(args.project ?? '').trim().toLowerCase();
      const list = m.bills.filter((b) => (!cat || b.category.toLowerCase() === cat) && (!q || b.name.toLowerCase().includes(q)) && (!proj || (b.project ?? '').toLowerCase() === proj || (b.project ?? '').toLowerCase().endsWith(`/${proj}`)));
      if (!list.length) return [m.bills.length ? 'No bill matches that.' : 'No bills yet.', refused].filter(Boolean).join('\n');
      const committed = list.reduce((s, b) => s + (b.monthly ?? 0), 0);
      return [
        `${plural(list.length, 'bill')}, about ${money(Math.round(committed * 100) / 100)} a month together:`,
        ...list.map((b) => `- ${b.name} (${b.kind.toLowerCase()}, ${b.category}): ${money(b.amount)} ${b.cycle.toLowerCase()}${b.monthly !== null && b.cycle !== 'Monthly' ? ` (${money(b.monthly)} a month)` : ''}; ${b.status !== 'Active' ? b.status.toLowerCase() : b.next ? `next due ${dueWords(b.next, m.today)}${b.overdue ? ' (overdue)' : ''}` : 'no due day written'}${b.autopay ? ', autopay' : ''}${b.project ? `, for ${b.project}` : ''}${b.change ? `; price went from ${money(b.change.from)} to ${money(b.change.to)}${b.change.date ? ` on ${dueWords(b.change.date, m.today)}` : ''}` : ''} [${b.path}]`),
        refused,
      ]
        .filter(Boolean)
        .join('\n');
    }
    if (name === 'finance_forecast') {
      const days = typeof args.days === 'number' && args.days > 0 ? Math.min(366, Math.round(args.days)) : 90;
      const given: IncomeEntry[] = readMoney(args.income_amount) !== null && readMoney(args.income_amount)! > 0 ? [{ name: String(args.income_name ?? 'Pay').slice(0, 60) || 'Pay', amount: readMoney(args.income_amount)!, cycle: readCycle(args.income_cycle ?? 'Monthly'), next: args.income_next ? readIsoDay(args.income_next) : null }] : [];
      const f = financeForecast(m, { days, income: given.length ? given : (input.income ?? []) });
      const lines = [`The next ${f.days} days (to ${dueWords(f.to, m.today)}): ${money(f.totalOut)} going out${f.totalIn ? `, ${money(f.totalIn)} expected in` : ', no pay expected is written'}${f.startingBalance !== null ? `, starting from ${money(f.startingBalance)} in the accounts` : ''}${f.debtTotal ? `, owes ${money(f.debtTotal)} on cards and loans` : ''}.`];
      if (f.tightest) lines.push(`Tightest week: ${dueWords(f.tightest.start, m.today)} to ${dueWords(f.tightest.end, m.today)}, ${money(f.tightest.out)} out${f.tightest.in ? `, ${money(f.tightest.in)} in` : ''}${f.tightest.balance !== null ? `, ending at ${money(f.tightest.balance)}` : ''}.`);
      if (typeof args.amount === 'number' && readMoney(args.amount) !== null) {
        const a = affordCheck(f, readMoney(args.amount)!);
        if (!a.known) lines.push(`Whether ${money(readMoney(args.amount))} fits is not known yet: no pay or account balance is written. Ask for their pay (amount, how often, next day) and pass it, or say it can be added in Money options.`);
        else lines.push(a.ok ? `A cost of ${money(readMoney(args.amount))} fits: ${money(a.spare)} to spare at the lowest point${a.balanceKnown ? '' : ' (on money in and out; no account balance is written)'}.` : `A cost of ${money(readMoney(args.amount))} does not fit yet: it would go ${money(-a.spare)} under at the lowest point${a.balanceKnown ? '' : ' (on money in and out; no account balance is written)'}.`);
      }
      lines.push(...f.events.slice(0, 40).map((e) => `- ${dueWords(e.date, m.today)}: ${e.name} ${e.kind === 'income' ? `in ${money(e.amount)}` : `${money(e.amount)} (${e.kind})`}${e.path ? ` [${e.path}]` : ''}`), ...(f.events.length > 40 ? [`- … and ${f.events.length - 40} more`] : []));
      if (!f.events.length) lines.push('Nothing falls in that time: no bills with a day and amount, and no pay expected written.');
      if (refused) lines.push(refused);
      return lines.join('\n');
    }
    if (name === 'finance_spending') {
      const month = /^\d{4}-\d{2}$/.test(String(args.month ?? '')) ? String(args.month) : m.thisMonth;
      const cat = String(args.category ?? '').trim().toLowerCase();
      const rows = m.spending.filter((s) => s.date.startsWith(month) && (!cat || s.category.toLowerCase() === cat));
      const ms = m.months.find((x) => x.month === month);
      const lines: string[] = [];
      if (!rows.length) lines.push(`Nothing spent is recorded for ${monthWords(month)}${cat ? ` in ${args.category}` : ''} (spending comes from bank CSVs imported and receipts added in Money).`);
      else if (cat) {
        const total = rows.reduce((s, r) => s + r.amount, 0);
        lines.push(`${String(args.category)} in ${monthWords(month)}: ${money(Math.round(total * 100) / 100)} over ${plural(rows.length, 'payment')}:`, ...rows.slice(0, 40).map((r) => `- ${dueWords(r.date, m.today)} ${r.what}: ${money(r.amount)}`), ...(rows.length > 40 ? [`- … and ${rows.length - 40} more`] : []));
      } else if (ms) {
        lines.push(`${monthWords(month)}: ${money(ms.total)} spent.`, 'By category:', ...Object.entries(ms.byCategory).sort((a, b) => b[1] - a[1]).map(([c, v]) => `- ${c}: ${money(v)}`));
        if (ms.transfers) lines.push(`Plus ${money(ms.transfers)} in card and loan repayments, not counted as spending.`);
      }
      if (month === m.thisMonth && m.budgets.length) lines.push('Budgets this month:', ...m.budgets.filter((b) => !cat || b.category.toLowerCase() === cat).map((b) => `- ${b.category}: ${money(b.spent)} of ${money(b.monthly)}${b.left !== null ? (b.left < 0 ? ` (over by ${money(-b.left)})` : ` (${money(b.left)} left)`) : ''}`));
      const before = m.months.filter((x) => x.month < month).slice(-3);
      if (before.length && !cat) lines.push(`Months before: ${before.map((x) => `${monthWords(x.month)} ${money(x.total)}`).join(', ')}.`);
      if (refused) lines.push(refused);
      return lines.join('\n');
    }
  }
  if (tool.module === 'documents') {
    const m = documentsModel(input.documents, today, input.remindDays?.documents ?? 60);
    const refused = refusedWords(input, 'documents');
    const line = (d: (typeof m.documents)[number]) => `- ${d.name}: ${d.kind}${d.holder ? `, ${d.holder}’s` : ''}${d.issuer ? `, from ${d.issuer}` : ''}; ${expiryWords(d, m.today)}${d.version ? `; version ${d.version}` : ''}${d.secret ? '; number locked in Secrets' : ''}${d.files.length ? `; ${plural(d.files.length, 'file')}` : ''} [${d.path}]`;
    if (name === 'document_expiring') {
      const days = typeof args.days === 'number' && args.days > 0 ? Math.min(3650, Math.round(args.days)) : null;
      const list = days === null ? m.expiring : m.documents.filter((d) => d.days !== null && d.days <= days).sort((a, b) => (a.expires ?? '').localeCompare(b.expires ?? ''));
      if (!list.length) return [days === null ? 'Nothing has expired or expires soon.' : `Nothing expires in the next ${plural(days, 'day')}.`, refused].filter(Boolean).join('\n');
      return [`${plural(list.length, 'document')} to renew:`, ...list.map(line), refused].filter(Boolean).join('\n');
    }
    if (name === 'document_list') {
      const kind = String(args.kind ?? '').trim().toLowerCase();
      const holder = String(args.holder ?? '').trim().toLowerCase();
      const list = m.documents.filter((d) => (!kind || d.kind.toLowerCase() === kind) && (!holder || d.holder.toLowerCase().includes(holder)));
      if (!list.length) return [m.documents.length ? 'No document matches that.' : 'No documents yet.', refused].filter(Boolean).join('\n');
      return [`${plural(list.length, 'document')}:`, ...list.map(line), refused].filter(Boolean).join('\n');
    }
  }
  return null;
}

// ── Writes ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface PlannedNote {
  /** The new note's path (the caller makes it free: "Name 2.md" when taken). */
  folder: string;
  name: string;
  text: string;
  /** What to tell the person once it is written. */
  words: string;
  /** Set when the record already exists: the caller updates this note instead of making one (9.2: never "X 2"). */
  update?: { path: string; fields: Record<string, unknown> };
  /** A new bill's fields as given (bills as one list, 8 Nov 2026): callers that keep the Bills list add a
   *  row with these instead of writing `text` as a note; callers without the list write `text` as before. */
  billInput?: { name: string; amount: number | null; cycle: string; due: string | null; category: string; account?: string; project?: string; autopay: boolean; kind?: 'Bill' | 'Subscription' };
}

/** A write tool's new note, from its arguments: `areas` the vault's areas (id, folder) for the module's folder. Throws in
 *  plain words an agent can pass on. With `notes`, an add that names a record already there plans an update of it
 *  instead (its new amount, day): new only when nothing fits. */
export function planRecordModuleWrite(name: string, args: Record<string, unknown>, ctx: { on: readonly string[]; areas: readonly { id: string; folder: string }[] | null; today?: Date; currency?: string; notes?: Pick<ModuleToolInput, 'finance' | 'documents'> }): PlannedNote {
  const mod = moduleOfTool(name);
  if (!mod) throw new Error(`There is no tool called ${name}.`);
  if (!ctx.on.includes(mod.id)) throw new Error(offWords(mod.id));
  const today = ctx.today ?? new Date();
  const finance = ctx.notes?.finance ?? [];
  if (name === 'finance_bill_add') {
    const title = safeFileName(String(args.name ?? ''));
    if (!String(args.name ?? '').trim()) throw new Error('A bill needs a name.');
    const amount = readMoney(args.amount);
    const due = args.due === undefined || args.due === null || args.due === '' ? null : readIsoDay(args.due);
    if (args.due && !due) throw new Error('Give the due day as YYYY-MM-DD.');
    const category = BILL_CATEGORIES.find((c) => c.toLowerCase() === String(args.category ?? '').toLowerCase()) ?? (args.subscription ? 'Subscriptions' : 'Other');
    // An unknown cycle is refused, never silently Monthly (2 Nov 2026, money parity F8: "every 6 weeks" drifted).
    // Notes still read unknown as Monthly (readCycle, back-compat); the tool never guesses.
    const cycle = args.cycle === undefined || args.cycle === null || args.cycle === '' ? 'Monthly' : (BILL_CYCLES.find((c) => c.toLowerCase() === String(args.cycle).trim().toLowerCase()) ?? null);
    if (!cycle) throw new Error(`Give how often as one of: ${[...BILL_CYCLES].join(', ')}.`);
    // A bill's account is where the money comes FROM, never the bill itself (9.2 live evidence: Credit Card's account
    // was set to [[Harbour Credit Card]]). Only a known Account is written; anything else stays empty, and says so.
    let account = typeof args.account === 'string' && args.account.trim() ? args.account.trim() : undefined;
    let droppedAccount: string | null = null;
    const fm = financeModel(finance, today);
    if (account) {
      let ok = false;
      try {
        ok = !sameRecordName(resolveOne(fm.accounts, account, { noun: 'account', where: 'in Money' }).name, title);
      } catch {
        ok = false;
      }
      if (!ok) {
        droppedAccount = account;
        account = undefined;
      }
    }
    const autopay = args.autopay === true;
    const kind = args.subscription ? 'Subscription' : undefined;
    const project = typeof args.project === 'string' && args.project.trim() ? args.project.trim().slice(0, 120) : undefined;
    const known = findKnown(fm.bills, title, 'bill');
    if (known) {
      const fields: Record<string, unknown> = {};
      if (amount !== null) fields.amount = amount;
      if (due) fields.due = due;
      if (args.cycle !== undefined) fields.cycle = cycle;
      if (args.category !== undefined || args.subscription) fields.category = category;
      if (account !== undefined) fields.account = account;
      if (project !== undefined) fields.project = project;
      if (args.autopay !== undefined) fields.autopay = autopay;
      if (kind) fields.kind = kind;
      const said = [amount !== null ? moneyWords(amount, ctx.currency ?? 'AUD') : '', due ? `due ${dueWords(due, isoOf(today))}` : ''].filter(Boolean).join(', ');
      return { folder: typeFolder('bill', ctx.areas), name: title, text: '', words: `Updated the bill ${known.name}${said ? ` (${said})` : ''} in Money: it is already there, so nothing new was made.${droppedAccount ? ` The account “${droppedAccount}” isn’t in Money, so it was left empty.` : ''}`, update: { path: known.path, fields } };
    }
    // Past this point the bill is new, and a new bill needs its category (a subscription says what it is). Updates
    // never reach here, so they are never asked for it again.
    if (!String(args.category ?? '').trim() && !args.subscription) throw new Error(`A new bill needs a category. category: ${BILL_CATEGORY_DESC}`);
    const text = newBillText({ name: title, amount, cycle, due, category, account, project, autopay, kind });
    const cur = ctx.currency ?? 'AUD';
    return { folder: typeFolder('bill', ctx.areas), name: title, text, words: `Added the bill ${title}${amount !== null ? ` (${moneyWords(amount, cur)} ${cycle.toLowerCase()})` : ''}${due ? `, due ${dueWords(due, isoOf(today))}` : ''}${project ? `, for ${project}` : ''} to Money.${droppedAccount ? ` The account “${droppedAccount}” isn’t in Money, so it was left empty.` : ''}`, billInput: { name: title, amount, cycle, due, category, ...(account ? { account } : {}), ...(project ? { project } : {}), autopay, ...(kind ? { kind } : {}) } };
  }
  if (name === 'finance_account_add') {
    const title = safeFileName(String(args.name ?? ''));
    if (!String(args.name ?? '').trim()) throw new Error('An account needs a name.');
    if (args.number !== undefined || args.login !== undefined) throw new Error('Account numbers and logins are never written in a note: the person keeps them in Secrets in Ironleaf.');
    const balance = args.balance === undefined || args.balance === null ? null : readMoney(args.balance);
    if (args.balance !== undefined && args.balance !== null && balance === null) throw new Error('Give its balance as a number.');
    const known = findKnown(financeModel(finance, today).accounts, title, 'account');
    if (known) {
      const fields: Record<string, unknown> = {};
      if (String(args.institution ?? '').trim()) fields.institution = String(args.institution).trim().slice(0, 80);
      if (args.kind !== undefined) fields.kind = String(args.kind).slice(0, 40);
      if (String(args.holder ?? '').trim()) fields.holder = String(args.holder).trim().slice(0, 80);
      if (balance !== null) fields.balance = balance;
      return { folder: typeFolder('bank-account', ctx.areas), name: title, text: '', words: `Updated the account ${known.name} in Money: it is already there, so nothing new was made.`, update: { path: known.path, fields } };
    }
    const text = newAccountText({ institution: String(args.institution ?? '').trim().slice(0, 80), kind: String(args.kind ?? 'Everyday').slice(0, 40), holder: String(args.holder ?? '').trim().slice(0, 80), balance });
    return { folder: typeFolder('bank-account', ctx.areas), name: title, text, words: `Added the account ${title} to Money. Its number, if it has one, is for the person to add in Secrets.` };
  }
  if (name === 'finance_budget_add') {
    const category = String(args.category ?? '').trim().slice(0, 40);
    if (!category) throw new Error('A budget needs a category.');
    const amount = readMoney(args.amount);
    if (amount === null || amount <= 0) throw new Error('Give how much the budget is.');
    const period = /week/i.test(String(args.period ?? '')) ? 'Weekly' : /year/i.test(String(args.period ?? '')) ? 'Yearly' : 'Monthly';
    const known = findKnown(financeModel(finance, today).budgets.map((b) => ({ name: b.category, path: b.path })), category, 'budget');
    if (known) return { folder: typeFolder('budget-category', ctx.areas), name: safeFileName(category), text: '', words: `Set the ${known.name} budget at ${moneyWords(amount, ctx.currency ?? 'AUD')} ${period.toLowerCase()} in Money: it is already there, so nothing new was made.`, update: { path: known.path, fields: { amount, period } } };
    return { folder: typeFolder('budget-category', ctx.areas), name: safeFileName(category), text: newBudgetText(amount, period), words: `Set the ${category} budget at ${moneyWords(amount, ctx.currency ?? 'AUD')} ${period.toLowerCase()} in Money.` };
  }
  if (name === 'document_add') {
    // A reading off a photo or scan goes through the same check: its kind tidied, its days read, a number dropped.
    const reading = documentFromReading(args);
    const kind = DOCUMENT_KINDS.find((k) => k.toLowerCase() === String(args.kind ?? '').toLowerCase()) ?? reading.input.kind;
    const holder = String(args.holder ?? '').trim().slice(0, 80) || reading.input.holder;
    const version = String(args.version ?? '').trim().slice(0, 20);
    const issued = args.issued ? readIsoDay(args.issued) : null;
    const expires = args.expires ? readIsoDay(args.expires) : null;
    if (args.expires && !expires) throw new Error('Give the expiry day as YYYY-MM-DD.');
    const remind = typeof args.remind === 'number' ? Math.max(0, Math.min(730, Math.round(args.remind))) : defaultRemindForKind(kind);
    const title = safeFileName(documentName({ kind, holder, version }));
    const known = (ctx.notes?.documents ?? []).find((n) => sameRecordName(n.title, title));
    // Papers keeps old copies beside renewed ones: an add never merges into one (document_renewed owns that).
    if (known) throw new Error(`There is already ${known.title} in Papers [${known.path}]. A renewal goes through document_renewed.`);
    const text = newDocumentText({ kind, holder, issuer: String(args.issuer ?? '').trim().slice(0, 80), issued, expires, remind, version });
    return { folder: typeFolder('id-document', ctx.areas), name: title, text, words: `Added ${title} to Papers${expires ? `, expiring ${dueWords(expires, isoOf(today))}` : ''}. Its number, if it has one, is for the person to add in Secrets.` };
  }
  throw new Error(`There is no tool called ${name}.`);
}

/** An account's own name from what was given (bare, path or link), or null when unknown (2 Nov 2026,
 *  money parity F2: a path landed raw, an unknown landed as a dead link). */
function resolveAccountName(accounts: readonly { name: string; path: string; names?: string[] }[], raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  try {
    return resolveOne(accounts, s, { noun: 'account', where: 'in Money' }).name;
  } catch {
    return null;
  }
}

/** finance_bill_mark_paid's bill, day, account and amount, from its arguments. Throws in plain words an agent can pass on. */
export function planMarkPaid(args: Record<string, unknown>, input: ModuleToolInput): { path: string; day: string; account: string; amount: number | null; words: string } {
  if (!input.on.includes('finance')) throw new Error(offWords('finance'));
  const m = financeModel(input.finance, input.today ?? new Date());
  if (!String(args.bill ?? '').trim()) throw new Error('Say which bill was paid.');
  const found = resolveOne(m.bills, args.bill, { noun: 'bill', where: 'in Money' });
  const day = args.date === undefined || args.date === null || args.date === '' ? m.today : readIsoDay(args.date);
  if (!day) throw new Error('Give the day it was paid as YYYY-MM-DD.');
  const amount = args.amount === undefined || args.amount === null || args.amount === '' ? null : readMoney(args.amount);
  if (args.amount !== undefined && args.amount !== null && args.amount !== '' && (amount === null || amount <= 0)) throw new Error('Give how much was paid as a number.');
  // Paid from the bill itself is never written (9.2): the source account stays as the bill already says.
  const rawAccount = String(args.account ?? '').trim().slice(0, 80);
  let account = '';
  let dropped: string | null = null;
  if (rawAccount) {
    if (sameRecordName(normalizeRef(rawAccount) || rawAccount, found.name)) account = '';
    else {
      const resolved = resolveAccountName(m.accounts, rawAccount);
      if (resolved) account = resolved;
      else {
        account = '';
        dropped = rawAccount;
      }
    }
  }
  const shown = amount ?? found.amount;
  return { path: found.path, day, account, amount, words: `Marked ${found.name} paid${shown !== null ? ` (${moneyWords(shown, input.currency ?? 'AUD')})` : ''}${account ? ` from ${account}` : ''}.${dropped ? ` The account “${dropped}” isn’t in Money, so it was left empty.` : ''}` };
}

/** Refusal when paid on a bill comes with anything else in the one properties call: recording the payment would
 *  silently drop the rest, so the agent sets paid on its own instead. */
export const BILL_PROPS_SOLO = 'Paid on a bill is recorded with Mark paid (finance_bill_mark_paid): set paid on its own, and anything else separately. Nothing was changed.';

/** A bill note's paid and due as the property tools were asked to change them (2 Nov 2026, the credit-card run: paid
 *  was set on the bill without moving its due day or recording the payment, then cleared the same way). paid and due
 *  on a bill are kept by Mark paid, never written directly: setting paid to a day records the payment the way
 *  finance_bill_mark_paid does; clearing paid, and changing the day it falls, are refused with the tool to use
 *  instead. Pure: both property tools (the catalogue's note_set_properties and the side chat's set_properties) decide
 *  by this, so the rule holds whichever door the agent uses. */
export function planBillPropEdit(content: string, props: Record<string, unknown>): { route: 'allow' } | { route: 'markPaid'; day: string } | { route: 'refuse'; words: string } {
  if (frontType(content) !== 'bill') return { route: 'allow' };
  const keys = Object.keys(props ?? {});
  const paid = keys.find((k) => k.toLowerCase() === 'paid');
  const due = keys.find((k) => k.toLowerCase() === 'due');
  if (due !== undefined) {
    const clearing = props[due] === null || props[due] === undefined || (typeof props[due] === 'string' && !String(props[due]).trim());
    return clearing
      ? { route: 'refuse', words: 'A bill keeps the day it falls: change it to the right day with finance_bill_add. Nothing was changed.' }
      : { route: 'refuse', words: 'The day a bill falls is changed with finance_bill_add, which updates the bill in place; a payment is recorded with finance_bill_mark_paid. Nothing was changed.' };
  }
  if (paid !== undefined) {
    const v = props[paid];
    if (v === null || v === undefined || (typeof v === 'string' && !v.trim())) return { route: 'refuse', words: 'Paid on a bill is kept by Mark paid (finance_bill_mark_paid), which moves the due day and records the payment: clearing it here would leave the bill half-updated, so nothing was changed. To undo a payment, undo the change that recorded it instead.' };
    const day = readIsoDay(v);
    if (!day) throw new Error('Give the day it was paid as YYYY-MM-DD.');
    return { route: 'markPaid', day };
  }
  return { route: 'allow' };
}

/** One frontmatter value as written (no YAML library, like sensitivity.ts's own readers, so the former host app can use
it). */
const frontRaw = (text: string, key: string): string => {
  const m = /^(?:\uFEFF)?(?:[ \t]*\r?\n)*---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(text);
  if (!m) return '';
  const line = new RegExp(`^${key}:[ \\t]*(.*)$`, 'im').exec(m[1]);
  return line ? line[1].replace(/\r$/, '').trim().replace(/\s+#.*$/, '').replace(/^["']|["']$/g, '').trim() : '';
};

/** The note with one frontmatter day set back to what it was (null: the line taken off again). */
function setFrontDay(text: string, key: 'paid' | 'due', day: string | null): string {
  const lines = text.split('\n');
  let open = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = i === 0 ? lines[i].replace(/^\uFEFF/, '') : lines[i];
    if (/^[ \t]*\r?$/.test(t)) continue;
    if (/^---[ \t]*\r?$/.test(t)) open = i;
    break;
  }
  const put = day ? `${key}: ${day}` : null;
  if (open < 0) return put ? `---\n${put}\n---\n${text}` : text;
  let close = -1;
  for (let i = open + 1; i < lines.length; i++) if (/^(---|\.\.\.)[ \t]*\r?$/.test(lines[i])) {
    close = i;
    break;
  }
  if (close < 0) return put ? `---\n${put}\n---\n${text}` : text;
  const eol = /\r$/.test(lines[open]) ? '\r' : '';
  const at = lines.findIndex((l, i) => i > open && i < close && new RegExp(`^${key}:`, 'i').test(l.replace(/\r$/, '')));
  if (at < 0) {
    if (!put) return text;
    lines.splice(close, 0, `${put}${eol}`);
    return lines.join('\n');
  }
  if (!put) lines.splice(at, 1);
  else lines[at] = `${put}${eol}`;
  return lines.join('\n');
}

/** What the tool's answer says when a free-text write left a bill's paid or due alone: which tool does that change. */
const billKeptNote = (kept: readonly ('paid' | 'due')[]): string =>
  kept.length === 2
    ? 'Paid and due on this bill were kept as they were: a payment is recorded with Mark paid (finance_bill_mark_paid), and the day it falls is changed with finance_bill_add.'
    : kept[0] === 'paid'
      ? 'Paid on this bill was kept as it was: a payment is recorded with Mark paid (finance_bill_mark_paid), which moves the due day and records it.'
      : 'Due on this bill was kept as it was: the day a bill falls is changed with finance_bill_add.';

/** A bill note's paid and due as a free-text write left them (2 Nov 2026, the no-way-around-Mark-paid pass:
 *  note_write and edit_note rewrote them as free text, bypassing Mark paid's moved due day and Notes line).
 *  paid and due on a bill are kept by Mark paid and finance_bill_add, never written directly: a free-text write
 *  that changes either keeps the old value, and the tool's answer names the tool that does that change instead.
 *  Pure: every free-text write path (note_write, note_replace, edit_note) decides by this, so the rule holds
 *  whichever door the agent uses. */
export function guardBillFreeText(before: string, after: string): { text: string; kept: ('paid' | 'due')[]; note: string } {
  const none = { text: after, kept: [] as ('paid' | 'due')[], note: '' };
  // A new bill an assistant writes as free text starts unpaid (reviewer, 2 Nov 2026: a paid day comes only from Mark
  // paid, which moves the due day and records the payment); its due day stays as written.
  if (frontType(before) !== 'bill' && frontType(after) === 'bill' && readIsoDay(frontRaw(after, 'paid'))) {
    return { text: setFrontDay(after, 'paid', null), kept: ['paid'], note: billKeptNote(['paid']) };
  }
  if (frontType(before) !== 'bill' || before === after) return none;
  const jobs = (['paid', 'due'] as const)
    .map((key) => ({ key, was: readIsoDay(frontRaw(before, key)), now: readIsoDay(frontRaw(after, key)) }))
    .filter((j) => j.was !== j.now);
  if (!jobs.length) return none;
  let text = after;
  for (const j of jobs) text = setFrontDay(text, j.key, j.was);
  const kept = jobs.map((j) => j.key);
  return { text, kept, note: billKeptNote(kept) };
}

/** finance_receipt_add's payment, from what was read off the receipt. Throws in plain words an agent can pass on. */
export function planReceiptAdd(args: Record<string, unknown>, input: ModuleToolInput): { row: { date: string; what: string; category: string; amount: number; account: string; receipt: string }; words: string } {
  if (!input.on.includes('finance')) throw new Error(offWords('finance'));
  const date = args.date ? readIsoDay(args.date) : null;
  if (!date) throw new Error('Give the day on the receipt as YYYY-MM-DD (ask the person when it can’t be read).');
  const amount = readMoney(args.amount);
  if (amount === null || amount === 0) throw new Error('Give the amount on the receipt (ask the person when it can’t be read).');
  const what = String(args.what ?? '').trim().slice(0, 160);
  if (!what) throw new Error('Give who was paid, as printed on the receipt.');
  const m = financeModel(input.finance, input.today ?? new Date());
  // A refund nets its purchase's own category (2 Nov 2026, money parity F3: it landed in Refunds/Other
  // instead of reversing the purchase). 'Refunds' is never a bucket: treated as not given.
  const given = String(args.category ?? '').trim().slice(0, 40);
  const givenCat = given && given.toLowerCase() !== 'refunds' ? given : '';
  const category = amount < 0 ? (learnedCategories(m.spending).get(merchantKey(what)) ?? givenCat ?? 'Other') || 'Other' : givenCat || 'Other';
  const rawAccount = String(args.account ?? '').trim().slice(0, 80);
  const resolvedAccount = rawAccount ? resolveAccountName(m.accounts, rawAccount) : null;
  const account = resolvedAccount ?? '';
  const droppedAccount = rawAccount && !resolvedAccount ? rawAccount : null;
  const receipt = String(args.receipt ?? '').trim().slice(0, 300);
  // Filed twice (the photo, then the PDF) is filed once: the same day, amount and merchant words.
  const key = spendDedupeKey(date, amount, what);
  if (m.spending.some((s) => spendDedupeKey(s.date, s.amount, s.what) === key)) throw new Error(amount < 0 ? `That refund is already filed in Money: ${what}, ${moneyWords(-amount, input.currency ?? 'AUD')} back on ${date}.` : `That receipt is already filed in Money: ${what}, ${moneyWords(amount, input.currency ?? 'AUD')} on ${date}.`);
  const words = amount < 0 ? `Filed the refund in Money: ${what}, ${moneyWords(-amount, input.currency ?? 'AUD')} back on ${date} (${category}).` : `Filed the receipt in Money: ${what}, ${moneyWords(amount, input.currency ?? 'AUD')} on ${date} (${category}).`;
  return { row: { date, what, category, amount, account, receipt }, words: `${words}${droppedAccount ? ` The account “${droppedAccount}” isn’t in Money, so it was left empty.` : ''}` };
}

/** document_renewed's document and new days, from its arguments. Throws in plain words an agent can pass on. */
export function planDocumentRenewed(args: Record<string, unknown>, input: ModuleToolInput): { path: string; name: string; expires: string; issued: string | null; words: string } {
  if (!input.on.includes('documents')) throw new Error(offWords('documents'));
  const m = documentsModel(input.documents, input.today ?? new Date(), input.remindDays?.documents ?? 60);
  if (!String(args.document ?? '').trim()) throw new Error('Say which document was renewed.');
  const pick = (docs: IdDocument[]): IdDocument | undefined => {
    try {
      return resolveOne(docs, args.document, { noun: 'document', where: 'in Papers' });
    } catch (e) {
      if (e instanceof Error && /More than one/.test(e.message)) throw e;
      return undefined;
    }
  };
  // The current copy first: an old copy already renewed is kept for the record, and the same name reaches its new copy.
  const current = m.documents.filter((d) => d.status !== 'Renewed');
  const found = pick(current) ?? resolveOne(m.documents, args.document, { noun: 'document', where: 'in Papers' });
  const expires = args.expires ? readIsoDay(args.expires) : null;
  if (!expires) throw new Error('Give the new expiry day as YYYY-MM-DD.');
  const issued = args.issued ? readIsoDay(args.issued) : null;
  if (args.issued && !issued) throw new Error('Give the day it was issued as YYYY-MM-DD.');
  return { path: found.path, name: found.name, expires, issued, words: `Renewed ${found.name} to ${dueWords(expires, m.today)}: a new copy is in Papers and the old copy is kept.` };
}

export { documentFromReading, incomeFromSettings };

const isoOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** A bill read from an Inbox item's words, for the Inbox's "Add as a bill" (null: the words aren't a bill). */
export const inboxBill = billFromWords;
