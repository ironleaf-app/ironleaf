// Modules: one per part of life (Wave 5, 24 Oct 2026; the catalogue, 22 Oct: "Each module below is first-class like
// Projects: its own record type with set fields, its own views, what Today shows from it, automations, agent tools, and a
// default sensitivity level"). A module is made only from the vault's shared blocks, never a screen of its own:
//   - its records are notes of its own note types (src/shared/note-types.ts: a Bill, an Account, an ID document…), plain
//     Markdown the person owns, kept in the module's folder inside an area of life (Me/Finance/Bills/…);
//   - its pages are views of those records (src/shared/record-views.ts: table, board, calendar, chart…), each one click
//     from the module's page and changeable like any view;
//   - what Today shows from it, the bell's notices and its agent tools come from the same records;
//   - its sensitivity is its types' default level (src/shared/sensitivity.ts levelOf), so every agent's gate already
//     honours it, whether the module is on or off.
//
// Modules are off for a new vault and offered when the vault shows it would use one (bills written in notes, a passport
// scan in the Inbox). Turning one off hides its pages, its Today cards, its notices and its agent tools; every record
// stays exactly where it is, still typed, still at its level, and comes back when it is turned on again.
//
// Which modules there are and whether each is on is src/shared/life-modules.ts (the person's switches, Settings ›
// Modules); this file is what a module made of records holds: its note types, its folder inside its area, its pages, its
// level, its agent tools and when it is worth offering. Pure: no files, no Node, no DOM (the former host app uses it
// through tools/build-embedded.mjs).

import type { Level } from './sensitivity';
import { WORK_MODULES, WORK_REMIND, WORK_SIGNALS } from './work-modules';
import { PUBLICATIONS, PUBLICATION_SIGNALS } from './publication-module';
import { PERSONAL_MODULES, PERSONAL_REMIND } from './personal-modules';
import { LIFE_RECORD_MODULES, LIFE_RECORD_REMIND } from './life-records';
import { LIFE_MODULES } from './life-modules';

/** A field of a module's record type, as a note type has it (src/shared/note-types.ts TypeField; kept apart here so this
 *  file needs nothing else). */
export interface ModuleField {
  key: string;
  kind: 'text' | 'date' | 'time' | 'link' | 'links' | 'list' | 'url' | 'email' | 'phone' | 'choice' | 'number';
  options?: string[];
  linkType?: string;
  initial?: string;
}

/** One record type of a module: a note type that exists while its module is on (hidden, never lost, while it is off). */
export interface ModuleType {
  id: string;
  name: string;
  plural: string;
  /** One of note-types' TYPE_ICONS. */
  icon: string;
  /** One of note-types' TYPE_COLORS. */
  color: string;
  hint: string;
  fields: ModuleField[];
  template: string;
  /** Its folder inside the module's folder ("Bills" → Me/Finance/Bills). */
  sub: string;
  aliases: string[];
  empty: { title: string; line: string };
  /** Columns its note-type page starts with. */
  columns: string[];
  dateProp?: string;
}

/** One page of a module: a view of its records (src/shared/record-views.ts) with words of its own. */
export interface ModuleSection {
  id: string;
  label: string;
  /** One of the window's icon names. */
  icon: string;
  /** Under its name on the module's page. */
  line: string;
}

export interface RecordModule {
  id: string;
  name: string;
  /** The window's icon name. */
  icon: string;
  /** One line in Settings › Packs. */
  about: string;
  /** What it holds, in a few words ("Bills, subscriptions, accounts, budgets and receipts"). */
  holds: string;
  /** Its records' level unless the person sets another (Settings › Privacy and secrets). */
  level: Level;
  /** The area of life its folder goes in when the vault has areas (an area's id). */
  area: string;
  /** Its folder's name (inside that area, or at the top). */
  folder: string;
  types: ModuleType[];
  sections: ModuleSection[];
  /** Its agent tools' names (src/shared/module-tools.ts). */
  tools: string[];
  /** What the window says about where its numbers go (never into a note). */
  locked: string;
}

// ── The modules ──────────────────────────────────────────────────────────────────────────────────────────────────────

export const BILL_CYCLES = ['Weekly', 'Fortnightly', 'Monthly', 'Quarterly', 'Half-yearly', 'Yearly', 'Once'] as const;
export const BILL_CATEGORIES = ['Home and utilities', 'Phone and internet', 'Subscriptions', 'Insurance', 'Rent or mortgage', 'Loans and cards', 'Transport', 'Health', 'Education', 'Other'] as const;
export const SPEND_CATEGORIES = ['Groceries', 'Eating out', 'Transport', 'Fuel', 'Home and utilities', 'Phone and internet', 'Subscriptions', 'Insurance', 'Rent or mortgage', 'Health', 'Shopping', 'Entertainment', 'Education', 'Kids', 'Gifts', 'Travel', 'Fees and interest', 'Transfers', 'Other'] as const;
export const ACCOUNT_KINDS = ['Everyday', 'Savings', 'Credit card', 'Loan', 'Mortgage', 'Super', 'Investment', 'Other'] as const;
export const DOCUMENT_KINDS = ['Passport', 'Driver licence', 'ID card', 'Medicare card', 'Certificate', 'Insurance policy', 'CV', 'Visa', 'Birth certificate', 'Other'] as const;

export const FINANCE: RecordModule = {
  id: 'finance',
  name: 'Money',
  icon: 'wallet',
  about: 'Bills and subscriptions with their due days, accounts, budgets by category and receipts: what is due, what you spend, where it goes.',
  holds: 'Bills, subscriptions, accounts, budgets and receipts',
  level: 'personal',
  area: 'me',
  folder: 'Finance',
  locked: 'Account numbers and logins go in Secrets, never in a note.',
  types: [
    {
      id: 'bill',
      name: 'Bill',
      plural: 'Bills',
      icon: 'receipt',
      color: 'ochre',
      hint: 'A bill or subscription that comes round: its amount, how often and when it is due',
      fields: [
        { key: 'kind', kind: 'choice', options: ['Bill', 'Subscription'] },
        { key: 'amount', kind: 'number' },
        { key: 'cycle', kind: 'choice', options: [...BILL_CYCLES], initial: 'Monthly' },
        { key: 'due', kind: 'date' },
        { key: 'category', kind: 'choice', options: [...BILL_CATEGORIES], initial: 'Other' },
        { key: 'account', kind: 'link', linkType: 'bank-account' },
        { key: 'project', kind: 'link', linkType: 'project' },
        { key: 'nickname', kind: 'text' },
        { key: 'autopay', kind: 'choice', options: ['No', 'Yes'], initial: 'No' },
        { key: 'status', kind: 'choice', options: ['Active', 'Paused', 'Cancelled'], initial: 'Active' },
      ],
      template: '## Notes\n\n',
      sub: 'Bills',
      aliases: ['bills'],
      empty: { title: 'No bills yet.', line: 'Add a bill or subscription to see when it is due and what it costs each month.' },
      columns: ['amount', 'cycle', 'due', 'category', 'autopay'],
      dateProp: 'due',
    },
    {
      id: 'bank-account',
      name: 'Account',
      plural: 'Accounts',
      icon: 'bank',
      color: 'slate',
      hint: 'A bank account, card, loan or super fund (its numbers and logins stay in Secrets)',
      fields: [
        { key: 'institution', kind: 'text' },
        { key: 'nickname', kind: 'text' },
        { key: 'last4', kind: 'text' },
        { key: 'kind', kind: 'choice', options: [...ACCOUNT_KINDS], initial: 'Everyday' },
        { key: 'holder', kind: 'text' },
        { key: 'number', kind: 'text' },
        { key: 'balance', kind: 'number' },
        { key: 'as_of', kind: 'date' },
      ],
      template: '## Notes\n\n',
      sub: 'Accounts',
      aliases: ['bank account', 'bank accounts'],
      empty: { title: 'No accounts yet.', line: 'Add the accounts your bills come out of. Numbers and logins go in Secrets.' },
      columns: ['institution', 'kind', 'balance', 'as_of'],
    },
    {
      id: 'budget-category',
      name: 'Budget',
      plural: 'Budgets',
      icon: 'chart',
      color: 'sage',
      hint: 'How much you mean to spend on one category each month',
      fields: [
        { key: 'amount', kind: 'number' },
        { key: 'period', kind: 'choice', options: ['Monthly', 'Weekly', 'Yearly'], initial: 'Monthly' },
      ],
      template: '',
      sub: 'Budgets',
      aliases: ['budget category', 'budget categories'],
      empty: { title: 'No budgets yet.', line: 'Set how much you mean to spend on groceries, eating out or anything else.' },
      columns: ['amount', 'period'],
    },
    {
      id: 'spending-month',
      name: 'Spending month',
      plural: 'Spending months',
      icon: 'table',
      color: 'stone',
      hint: 'One month of money spent: imported from your bank or added by hand, with receipts',
      fields: [{ key: 'month', kind: 'text' }],
      template: '## Spending\n\n| Date | What | Category | Amount | Account | Receipt |\n| --- | --- | --- | --- | --- | --- |\n',
      sub: 'Spending',
      aliases: ['spending month', 'spending months'],
      empty: { title: 'No spending yet.', line: 'Import a CSV from your bank, or add what you spend with its receipt.' },
      columns: ['month'],
    },
  ],
  sections: [
    { id: 'overview', label: 'Overview', icon: 'wallet', line: 'What is due, what you spend each month and how your budgets stand.' },
    { id: 'bills', label: 'Bills', icon: 'receipt', line: 'Every bill and subscription: amount, how often, when it is due, the account it comes out of.' },
    { id: 'calendar', label: 'Due dates', icon: 'calendar', line: 'Each bill on every day it falls, a month back to a year ahead.' },
    { id: 'spending', label: 'Spending', icon: 'chart', line: 'Money spent each month, by category, from your bank’s CSV and your receipts.' },
    { id: 'budgets', label: 'Budgets', icon: 'target', line: 'What you mean to spend on each category this month, beside what you have spent.' },
    { id: 'accounts', label: 'Accounts', icon: 'bank', line: 'The accounts bills come out of. Numbers and logins are kept in Secrets.' },
    { id: 'receipts', label: 'Receipts', icon: 'file', line: 'Receipts kept with what they paid for.' },
  ],
  tools: ['finance_bill_add', 'finance_bill_list', 'finance_bills_due', 'finance_spending', 'finance_bill_mark_paid', 'finance_forecast', 'finance_receipt_add', 'finance_account_add', 'finance_budget_add', 'finance_csv_import'],
};

export const DOCUMENTS: RecordModule = {
  id: 'documents',
  name: 'Papers',
  icon: 'idcard',
  about: 'Passports, licences, certificates, insurance policies and CV versions, with their files and expiry reminders. Numbers are kept in Secrets.',
  holds: 'Passports, licences, certificates, insurance and CVs',
  level: 'personal',
  area: 'me',
  folder: 'Documents and ID',
  locked: 'Document numbers are kept in Secrets and shown only when Secrets are unlocked.',
  types: [
    {
      id: 'id-document',
      name: 'ID document',
      plural: 'Documents and ID',
      icon: 'idcard',
      color: 'plum',
      hint: 'A passport, licence, certificate, insurance policy or CV, with its expiry and files',
      fields: [
        { key: 'kind', kind: 'choice', options: [...DOCUMENT_KINDS], initial: 'Passport' },
        { key: 'holder', kind: 'text' },
        { key: 'issuer', kind: 'text' },
        { key: 'number', kind: 'text' },
        { key: 'issued', kind: 'date' },
        { key: 'expires', kind: 'date' },
        { key: 'remind', kind: 'number' },
        { key: 'version', kind: 'text' },
      ],
      template: '## Files\n\n\n## Notes\n\n',
      sub: '',
      aliases: ['id document', 'id documents', 'documents and id'],
      empty: { title: 'No documents yet.', line: 'Add a passport, licence or certificate to be reminded before it expires.' },
      columns: ['kind', 'holder', 'expires', 'issuer'],
      dateProp: 'expires',
    },
  ],
  sections: [
    { id: 'overview', label: 'Overview', icon: 'idcard', line: 'What expires soon, and every document by kind.' },
    { id: 'all', label: 'All documents', icon: 'table', line: 'Every document with its holder, issuer and expiry.' },
    { id: 'expiry', label: 'Expiry', icon: 'calendar', line: 'Each document on the day it expires.' },
    { id: 'cv', label: 'CV versions', icon: 'history', line: 'Each version of a CV, newest first.' },
  ],
  tools: ['document_add', 'document_list', 'document_expiring', 'document_renewed'],
};

/** Every module, in the order Settings › Packs shows them. */
// The work modules (Wave 6 part b: Meetings, Weekly Updates, Sites and Equipment, Vendors, Quotes and Contracts) are
// src/shared/work-modules.ts.
// Publications (Wave 6 part a) is src/shared/publication-module.ts.
export const MODULES: RecordModule[] = [
  FINANCE,
  DOCUMENTS,
  // Home, Vehicles, Career and Travel (Wave 7 part a): src/shared/personal-modules.ts.
  ...PERSONAL_MODULES,
  ...WORK_MODULES,
  PUBLICATIONS,
  // Memories and Media, Business, Systems and Home Lab, Goals and Habits, Reading, Watching and Lists (Wave 7 part b):
  // src/shared/life-records.ts.
  ...LIFE_RECORD_MODULES,
];

export const moduleById = (id: string): RecordModule | undefined => MODULES.find((m) => m.id === id);

/** The module a note type belongs to, if any. */
export function moduleOfType(typeId: string | undefined | null): RecordModule | undefined {
  const t = String(typeId ?? '')
    .trim()
    .toLowerCase();
  return t ? MODULES.find((m) => m.types.some((x) => x.id === t)) : undefined;
}

/** A module type's default level (sensitivity.ts levelOf uses it after the person's own type default). */
export function moduleTypeLevel(typeId: string | undefined | null): Level | undefined {
  // A Systems list holds Systems records, so it has the Systems level too (records as data, 5 Nov 2026).
  if (String(typeId ?? '').trim().toLowerCase() === 'systems-table') return moduleById('systems')?.level;
  // The Bills list holds bills, so it has Money's level too (bills as one list, 8 Nov 2026).
  if (String(typeId ?? '').trim().toLowerCase() === 'bills-table') return moduleById('finance')?.level;
  return moduleOfType(typeId)?.level;
}

/** Every module type, flat. */
export const MODULE_TYPES: (ModuleType & { module: string })[] = MODULES.flatMap((m) => m.types.map((t) => ({ ...t, module: m.id })));
export const MODULE_TYPE_IDS = MODULE_TYPES.map((t) => t.id);

/** Every word a `type:` may use for a pack record (each id and alias, lower case): what Notes leaves out by
 *  default, what Related, Today and Search treat as a record (5 Nov 2026, "your notes are yours"). */
const RECORD_WORDS: ReadonlySet<string> = new Set(MODULE_TYPES.flatMap((t) => [t.id.toLowerCase(), ...t.aliases.map((a) => a.toLowerCase())]));

/** Whether a type id (or another word for it) is a pack's record type (service, runbook, machine, bill…). */
export function isRecordTypeId(id: string | undefined | null): boolean {
  const t = String(id ?? '').trim().toLowerCase();
  return !!t && RECORD_WORDS.has(t);
}

/** Whether a note's properties say it is a pack's record (its `type:` naming a record type). */
export function isRecordProps(props: Record<string, unknown> | undefined): boolean {
  const v = props?.type;
  const raw = Array.isArray(v) ? v[0] : v;
  return typeof raw === 'string' && isRecordTypeId(raw);
}

/** Which module an agent tool is (so it is offered only while its module is on). */
export function moduleOfTool(name: string): RecordModule | undefined {
  return MODULES.find((m) => m.tools.includes(name));
}

// ── Where a module keeps its records, and its own options ────────────────────────────────────────────────────────────
// Whether a module is on is the person's switch (src/shared/life-modules.ts moduleOn, Settings › Packs); the callers pass
// the ids that are on. What belongs to the vault itself (the currency its amounts are in, how many days ahead it reminds,
// an offer put away) is kept in the vault's .neuralvault/module-options.json, so every PC shows the same.

export const MODULE_OPTIONS_FILE = '.neuralvault/module-options.json';

export interface ModuleOptions {
  /** Finance: the currency its amounts are in (AUD unless set). */
  currency?: string;
  /** Days before a bill's due day (Finance) or a document's expiry (Documents) that the bell says so. */
  remindDays?: number;
  /** The offer to turn it on was put away. */
  dismissed?: boolean;
  /** Each page's views as the person changed them ("bills:0" → a view as record-views.ts writes it), so every PC shows
   *  them the same. */
  views?: Record<string, unknown>;
  /** A module's own settings (Weekly Updates: the day it is due, who it goes to; Vendors: its currency), by name. */
  settings?: Record<string, string | number | boolean>;
  /** Finance: each bank's CSV columns as last read, keyed by its files' header words (src/shared/finance.ts). */
  bankProfiles?: Record<string, { date: number; what: number; amount: number; debit: number; credit: number; category: number; order: 'dmy' | 'mdy' }>;
}
export type ModuleOptionsFile = Record<string, ModuleOptions>;

/** The options file as left (by any PC, or by hand): anything not understood is left out, never an error. */
export function readModuleOptions(text: string | null | undefined): ModuleOptionsFile {
  const out: ModuleOptionsFile = {};
  if (!text || !String(text).trim()) return out;
  let raw: unknown;
  try {
    raw = JSON.parse(String(text).replace(/^\uFEFF/, ''));
  } catch {
    return out;
  }
  const list = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>).modules : undefined;
  if (!list || typeof list !== 'object' || Array.isArray(list)) return out;
  for (const [id, v] of Object.entries(list as Record<string, unknown>)) {
    if (!moduleById(id) || !v || typeof v !== 'object' || Array.isArray(v)) continue;
    const o = v as Record<string, unknown>;
    const s: ModuleOptions = {};
    if (typeof o.currency === 'string' && /^[A-Z]{3}$/.test(o.currency)) s.currency = o.currency;
    if (typeof o.remindDays === 'number' && Number.isFinite(o.remindDays)) s.remindDays = Math.max(0, Math.min(365, Math.round(o.remindDays)));
    if (o.dismissed === true) s.dismissed = true;
    if (o.views && typeof o.views === 'object' && !Array.isArray(o.views)) {
      const views: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(o.views as Record<string, unknown>).slice(0, 60)) if (/^[a-z0-9-]{1,30}:\d{1,2}$/.test(k) && v && typeof v === 'object') views[k] = v;
      if (Object.keys(views).length) s.views = views;
    }
    const own = cleanSettings(o.settings);
    if (own) s.settings = own;
    if (o.bankProfiles && typeof o.bankProfiles === 'object' && !Array.isArray(o.bankProfiles)) {
      const profiles: NonNullable<ModuleOptions['bankProfiles']> = {};
      for (const [k, v] of Object.entries(o.bankProfiles as Record<string, unknown>).slice(0, 20)) {
        if (!k || !v || typeof v !== 'object') continue;
        const p = v as Record<string, unknown>;
        const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x >= -1 && x < 64 ? Math.round(x) : -1);
        const cols = { date: n(p.date), what: n(p.what), amount: n(p.amount), debit: n(p.debit), credit: n(p.credit), category: n(p.category), order: (p.order === 'mdy' ? 'mdy' : 'dmy') as 'dmy' | 'mdy' };
        if (cols.date >= 0 && cols.what >= 0 && (cols.amount >= 0 || cols.debit >= 0)) profiles[k.slice(0, 300)] = cols;
      }
      if (Object.keys(profiles).length) s.bankProfiles = profiles;
    }
    out[id] = s;
  }
  return out;
}

/** The file's words, keys in a steady order (two PCs writing the same thing write the same bytes). */
export function writeModuleOptions(o: ModuleOptionsFile): string {
  const modules: Record<string, unknown> = {};
  for (const m of MODULES) {
    const s = o[m.id];
    if (!s) continue;
    const x: Record<string, unknown> = {};
    for (const k of ['currency', 'remindDays', 'dismissed', 'views', 'settings', 'bankProfiles'] as const) if (s[k] !== undefined && s[k] !== false) x[k] = s[k];
    if (Object.keys(x).length) modules[m.id] = x;
  }
  return `${JSON.stringify({ version: 1, modules }, null, '\t')}\n`;
}

/** One module's options changed (anything not given stays as it was). */
export function withModuleOptions(o: ModuleOptionsFile, id: string, patch: ModuleOptions): ModuleOptionsFile {
  if (!moduleById(id)) return o;
  const next: ModuleOptions = { ...(o[id] ?? {}) };
  if (patch.currency !== undefined) next.currency = /^[A-Z]{3}$/.test(patch.currency) ? patch.currency : undefined;
  if (patch.remindDays !== undefined) next.remindDays = Math.max(0, Math.min(365, Math.round(Number(patch.remindDays) || 0)));
  if (patch.dismissed !== undefined) next.dismissed = patch.dismissed || undefined;
  if (patch.views !== undefined) {
    const views = { ...(next.views ?? {}) };
    for (const [k, v] of Object.entries(patch.views)) {
      if (!/^[a-z0-9-]{1,30}:\d{1,2}$/.test(k)) continue;
      if (v === null) delete views[k];
      else if (typeof v === 'object') views[k] = v;
    }
    next.views = Object.keys(views).length ? views : undefined;
  }
  if (patch.bankProfiles !== undefined) next.bankProfiles = Object.keys(patch.bankProfiles).length ? patch.bankProfiles : undefined;
  if (patch.settings !== undefined) {
    const merged: Record<string, unknown> = { ...(next.settings ?? {}) };
    for (const [k, v] of Object.entries(patch.settings ?? {})) {
      if (v === null || v === '') delete merged[k];
      else merged[k] = v;
    }
    next.settings = cleanSettings(merged);
  }
  return { ...o, [id]: next };
}

/** A module's own settings as kept: short names, plain values, nothing else. */
function cleanSettings(raw: unknown): Record<string, string | number | boolean> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>).slice(0, 40)) {
    if (!/^[a-z][a-zA-Z0-9_]{0,30}$/.test(k)) continue;
    if (typeof v === 'string') out[k] = v.slice(0, 200);
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'boolean') out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

export const DEFAULT_REMIND: Record<string, number> = { finance: 3, documents: 60, ...PERSONAL_REMIND, ...WORK_REMIND, ...LIFE_RECORD_REMIND };
export const remindDaysOf = (o: ModuleOptionsFile | null | undefined, id: string): number => o?.[id]?.remindDays ?? DEFAULT_REMIND[id] ?? 7;
export const currencyOf = (o: ModuleOptionsFile | null | undefined): string => o?.finance?.currency ?? 'AUD';

type AreaPlace = { id: string; folder: string };

/** Where a module keeps its records: inside its area when the vault has areas ("Me/Finance"), else at the top
 *  ("Finance"). `areas` are the vault's areas (id and folder), or null for a vault without. */
export function moduleFolder(id: string, areas: readonly AreaPlace[] | null | undefined): string {
  const m = moduleById(id);
  if (!m) return '';
  const area = areas?.find((a) => a.id === m.area) ?? null;
  // A module with no folder of its own keeps its records in its area's folder (Publications).
  return area ? (m.folder ? `${area.folder}/${m.folder}` : area.folder) : m.folder || m.name;
}

/** Module folders left outside their area, and where each belongs (26 Oct 2026): a top-level "Finance" or "Systems and Home
 *  Lab" in a vault with areas (made before the areas were set up, or by something that wrote without reading them) goes
 *  into its area ("Me/Finance", "Home/Systems and Home Lab"). Only modules that are on, only a top-level folder named
 *  exactly as the module's folder is without areas, and never one already in its place (Publications keeps its area
 *  folder). */
export function strayModuleFolders(topFolders: readonly string[], on: readonly string[], areas: readonly AreaPlace[] | null | undefined): { from: string; to: string }[] {
  if (!areas?.length) return [];
  const out: { from: string; to: string }[] = [];
  for (const m of MODULES) {
    if (!on.includes(m.id)) continue;
    const loose = (m.folder || m.name).toLowerCase();
    const home = moduleFolder(m.id, areas);
    if (!home || home.toLowerCase() === loose) continue;
    const found = topFolders.find((f) => f.toLowerCase() === loose);
    if (found && !out.some((x) => x.from === found)) out.push({ from: found, to: home });
  }
  return out;
}

/** A module type's own folder ("Me/Finance/Bills"; a type with no sub-folder is the module's folder itself). */
export function typeFolder(typeId: string, areas: readonly AreaPlace[] | null | undefined): string {
  const m = moduleOfType(typeId);
  const t = MODULE_TYPES.find((x) => x.id === typeId);
  if (!m || !t) return '';
  const base = moduleFolder(m.id, areas);
  return t.sub ? `${base}/${t.sub}` : base;
}

/** The module types for the note types (src/shared/note-types.ts TypeContext.modules): each with its folder in this
 *  vault, and whether its module is on (`on`: the ids switched on). */
export function moduleTypeInputs(on: readonly string[], areas: readonly AreaPlace[] | null | undefined): { id: string; module: string; folder: string; on: boolean }[] {
  return MODULE_TYPES.map((t) => ({ id: t.id, module: t.module, folder: typeFolder(t.id, areas), on: on.includes(t.module) }));
}

// ── When a module would help (it is offered) ─────────────────────────────────────────────────────────────────────────

/** Words that say a note or a capture is about one module's things (read from structure and plain words only). */
const SIGNALS: Record<string, RegExp> = {
  finance: /\b(invoice|subscription|direct debit|amount due|payment due|budget|receipt|bank statement|autopay)\b/i,
  ...WORK_SIGNALS,
  publications: PUBLICATION_SIGNALS,
  documents: /\b(passport|driver'?s? licen[cs]e|licen[cs]e (?:number|expir\w*)|birth certificate|medicare card|visa|insurance policy|certificate|curriculum vitae|resume|\bcv\b)\b/i,
};
/** Cues that count in a title (deliberate) but need an amount or a day beside them in passing words (9.2: two notes
 *  about colleague Bill never offer the Money module). */
const WEAK_SIGNALS: Record<string, RegExp> = {
  finance: /\b(bills?|due (?:on|by|date))\b/i,
};
const AMOUNT_OR_DAY = /[$€£¥₹]\s?\d|\b\d[\d,]*\.\d{2}\b|\b\d{4}-\d{2}-\d{2}\b/;

export interface ModuleOffer {
  module: string;
  /** Why it is offered, in plain words ("3 notes talk about bills"). */
  why: string;
  /** What switching it on does, in the module's own words (src/shared/life-modules.ts offer.does). */
  does: string;
  count: number;
}

/** What switching a module on does when its catalogue entry says nothing (never another module's words). */
const offerDoes = (name: string): string => `Switch it on to keep these in ${name}, with what’s coming up on Today.`;

/**
 * The modules that are off (and not put away) that the vault would use: notes or captures whose names, `type:` or words
 * are about their things. Every module in the catalogue (src/shared/life-modules.ts) is weighed, each by its own offer:
 * its words (offer.signals, else its record module's here), its record types, what its notes are about and what
 * switching it on does. At least two notes (or one Inbox item) before one is offered, so a single passing mention never
 * nags.
 */
export function moduleOffers(on: readonly string[], options: ModuleOptionsFile | null | undefined, items: readonly { title: string; type?: string; words?: string; inbox?: boolean }[]): ModuleOffer[] {
  const out: ModuleOffer[] = [];
  for (const life of LIFE_MODULES) {
    if (on.includes(life.id) || options?.[life.id]?.dismissed) continue;
    const rec = MODULES.find((m) => m.id === life.id);
    const re = life.offer?.signals ?? SIGNALS[life.id];
    const weak = WEAK_SIGNALS[life.id];
    const types = rec?.types ?? [];
    if (!re && !weak && !types.length) continue;
    let notes = 0;
    let inbox = 0;
    for (const it of items) {
      const typed = !!it.type && types.some((t) => t.id === it.type || t.aliases.includes(String(it.type).toLowerCase()));
      const text = `${it.title} ${it.words ?? ''}`;
      const weakSaid = !!weak && (weak.test(it.title) || (weak.test(it.words ?? '') && AMOUNT_OR_DAY.test(text)));
      const said = typed || (!!re && (re.test(it.title) || re.test(it.words ?? ''))) || weakSaid;
      if (!said) continue;
      if (it.inbox) inbox++;
      else notes++;
    }
    if (notes >= 2 || inbox >= 1) {
      const about = (life.offer?.about ?? rec?.holds ?? life.name).replace(/^./, (c) => c.toLowerCase());
      const parts = [notes ? `${notes} ${notes === 1 ? 'note' : 'notes'}` : '', inbox ? `${inbox} ${inbox === 1 ? 'thing' : 'things'} in your Inbox` : ''].filter(Boolean);
      out.push({ module: life.id, why: `${parts.join(' and ')} ${notes + inbox === 1 ? 'is' : 'are'} about ${about}.`, does: life.offer?.does ?? offerDoes(life.name), count: notes + inbox });
    }
  }
  return out.sort((a, b) => b.count - a.count);
}
