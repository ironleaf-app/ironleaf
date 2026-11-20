// Finance and Documents and ID on the main side (Wave 5, 24 Oct 2026; src/shared/module-records.ts, finance.ts,
// id-documents.ts). Everything goes through the app's own ways in: notes written as every save is (indexed, kept in file
// recovery, shown in open tabs), files copied in beside their record (src/shared/file-records.ts filesFolderFor), the
// bell's notices through the reminders' own list (src/main/reminders.ts post). Nothing here runs while both modules are
// off: no timer, no file, no notice.
//
//   recmod:finance / recmod:documents   each module's model, read from the index (the notes in memory)
//   recmod:set-field                    one value changed where a view shows it (a bill's amount also goes in its price
//                                       history; a payment's value is its table cell)
//   recmod:add-*                        a bill, account, budget, payment or document made (never over one there: an add
//                                       that names one already there refuses, and tells where it is)
//   recmod:mark-paid                    a bill paid (its `paid:` set, its `due:` moved on; its payment added to that
//                                       month's spending unless it is a card or loan repayment, which is a transfer)
//   recmod:attach                       files kept with a record (a receipt with its payment, a scan with its document)
//   recmod:csv-pick, recmod:import-*    a bank's CSV read, shown, then added
//   recmod:options                      the vault's options for its modules (currency, days ahead)
//   recmod:offers                       modules that are off the vault would use
// The agents' tools (src/shared/record-module-tools.ts) are answered here for the side chat and outside agents, from the
// notes each one's gate lets through.

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { AREAS_FILE, readAreas } from '../shared/areas';
import { appendUnder } from '../shared/capture';
import { billNameKey, isBillsTableText, readBillsTable, renderBillRowNote, rowPathIn, splitBillRow, tableRel } from '../shared/bills-table';
import { addBillsRow, billRowByPath, billRowNoteText, billsRowProps, billsTableRelFor, dropBillsRows, findBillRow, promoteToBillNote, readBills, resolveBillRowTarget, resolveBillsConflictAt, rowsAsBillNotes, searchBillsRows, writeBills, type BillsWork } from './bills-tables';
import { billsMoveState, billsPreviewWords, deferBillsMove, planBillsMove, resumeBillsMove, runBillsMove, undoBillsMove, type BillsMoveState } from './bills-move';
import { filesFolderFor } from '../shared/file-records';
import { randomBytes } from 'node:crypto';
import { accountCellOf, advanceAnchor, bankColumns, billDueWords, billFromWords, cleanBankProfiles, dueWords, financeForecast, financeModel, firstOnOrAfter, guessCategory, incomeFromSettings, isoOf, isTransferBill, latestOccurrence, learnedCategories, merchantKey, moneyWords, newAccountText, newBudgetText, newSpendingText, nextDue, occurrenceCoveredBy, planBankImport, priceUpWords, readCycle, readIsoDay, readMoney, receiptBillMatch, receiptFromWords, safeFileName, spendCategoryOfBill, spendDedupeKey, spendOverWords, spendRows, spendingOverUsual, tightMonthWords, withBankProfile, withPrice, withSpendRows, withoutSpendRow, type BillInput, type FinanceModel, type FinanceNote, type ImportPlan, type ReceiptBillMatch, type SpendInput } from '../shared/finance';
import { documentName, documentsModel, newDocumentText, renewedDocumentTexts, type DocumentInput, type DocumentNote, type DocumentsModel } from '../shared/id-documents';
import { modulesOn as switchesOn, partOn, type ModuleSwitches } from '../shared/life-modules';
import { currencyOf, MODULE_OPTIONS_FILE, MODULES, MODULE_TYPE_IDS, moduleFolder, moduleOffers, moduleTypeInputs, readModuleOptions, remindDaysOf, typeFolder, withModuleOptions, writeModuleOptions, type ModuleOptions, type ModuleOptionsFile } from '../shared/module-records';
import type { BriefMoney } from '../shared/brief';
import type { BillsConflict } from '../shared/record-modules-api';
import { readTypes, resolveTypes, typeOfNote, type NoteType } from '../shared/note-types';
import { answerRecordModuleTool, planDocumentRenewed, planMarkPaid, planReceiptAdd, planRecordModuleWrite, RECORD_MODULE_TOOLS, type ModuleToolInput } from '../shared/record-module-tools';
import { EDITABLE, PROPERTY_OF } from '../shared/record-modules';
import { resolveOne, sameRecordName } from '../shared/record-match';
import { refusal, secretIdsIn } from '../shared/sensitivity';
import { setTableCell } from '../shared/layouts';
import { setNoteProp } from '../shared/views';
import { DOCS_FOLDER } from '../shared/doc-file';
import { parseCsv } from '../shared/csv';
import type { InboxItem } from '../shared/inbox';
import type { VaultIndex } from './indexer';
import { gateIndex, type Gate } from './agent-gate';
import { readTypesFile } from './note-types';
import type { Vault } from './vault';
import { devSwitch } from './dev-switch';

export interface RecordModulesDeps {
  vault(): Vault;
  index: VaultIndex;
  prefs(): { templatesFolder: string; modules: ModuleSwitches };
  /** Writes a note as every save does (indexed, file recovery, open tabs told). */
  writeNote(rel: string, text: string): Promise<void>;
  /** Copies files from the PC into a folder of the vault (never over one there), giving their paths. */
  importFiles(paths: string[], folder: string): Promise<string[]>;
  /** The open-file dialog: the files chosen (one unless `many`), or none. */
  pickFiles(options: { title: string; button: string; many?: boolean; filters?: { name: string; extensions: string[] }[] }): Promise<string[]>;
  /** The app's own move (every link to it kept). */
  movePath(from: string, to: string): Promise<{ path: string }>;
  /** A notice in the bell (and a Windows notification), said once for its key (Reminders.post). */
  post(items: { key: string; kind: string; title: string; body: string; path: string }[]): number;
  requireCreate(): Promise<void>;
  log?(message: string): void;
  now?(): Date;
  /** A vault file's words for receipt reading (a PDF's text, a photo's recognised words, or null when unread). */
  fileText?(rel: string): Promise<string | null>;
  /** This PC's app data (the Bills move's backup zip goes beside it). */
  dataDir?: string;
  device?: { id: string; name: string };
  appVersion?: string;
}

const MAX_CSV = 20 * 1024 * 1024;
const OWN_TYPES = new Set(MODULES.filter((m) => m.id === 'finance' || m.id === 'documents').flatMap((m) => m.types.map((t) => t.id)));
const CHECK_MS = 10 * 60_000;

/** A receipt photo or PDF by its name (10.0 v2money): what the Inbox offers to file as a receipt. */
export function isReceiptFile(name: string): boolean {
  return /\.(png|jpe?g|jfif|webp|heic|heif|bmp|gif|tif|tiff|avif|pdf)$/i.test(String(name ?? '').trim());
}

/** One payment's line on its bill (2 Nov 2026, money parity F6: the import wrote none, Mark paid did —
 *  now one helper, so every recorded payment writes the same words). */
function paidLine(bill: { amount: number | null; autopay: boolean }, date: string, covered: string | null, cur: string, today: string): string {
  return `- Paid${bill.amount !== null ? ` ${moneyWords(bill.amount, cur)}` : ''} on ${dueWords(date, today)}.${bill.autopay && covered && covered > date ? ` This cycle is covered: paid by hand before the autopay day ${dueWords(covered, today)}.` : ''}`;
}

export class RecordModules {
  private timer: ReturnType<typeof setInterval> | null = null;
  constructor(private d: RecordModulesDeps) {}

  private today(): Date {
    return this.d.now?.() ?? new Date();
  }
  /** The modules switched on (the person's switches, src/shared/life-modules.ts). */
  on(): string[] {
    return switchesOn(this.d.prefs().modules).map((m) => m.id);
  }
  private part(id: string, part: string): boolean {
    return partOn(this.d.prefs().modules, id, part);
  }

  private async read(rel: string): Promise<string | null> {
    try {
      return await fsp.readFile(path.join(this.d.vault().root, ...rel.split('/')), 'utf8');
    } catch {
      return null;
    }
  }
  async areas(): Promise<{ id: string; folder: string }[] | null> {
    return readAreas(await this.read(AREAS_FILE)).config?.areas ?? null;
  }
  async options(): Promise<ModuleOptionsFile> {
    return readModuleOptions(await this.read(MODULE_OPTIONS_FILE));
  }
  private async types(): Promise<NoteType[]> {
    const on = this.on();
    return resolveTypes(readTypes(await readTypesFile(this.d.vault().root)).config, { topFolders: [], templatesFolder: this.d.prefs().templatesFolder, docsFolder: DOCS_FOLDER, modules: moduleTypeInputs(on, await this.areas()) });
  }

  /** The notes of the modules' types an index has (the whole index, or an agent's gated one), each with its type. */
  async notesOf(index: VaultIndex): Promise<{ finance: FinanceNote[]; documents: DocumentNote[] }> {
    const types = await this.types();
    const finance: FinanceNote[] = [];
    const documents: DocumentNote[] = [];
    for (const m of index.allMeta()) {
      if (!/\.md$/i.test(m.path)) continue;
      const type = typeOfNote(m, types, this.d.prefs().templatesFolder);
      // Finance's and Documents and ID's own types only (the work modules read theirs in src/main/work-modules.ts).
      if (!type || !MODULE_TYPE_IDS.includes(type) || !OWN_TYPES.has(type)) continue;
      const content = index.content(m.path) ?? '';
      if (type === 'id-document') documents.push({ path: m.path, title: m.title, props: m.props ?? {}, content });
      else finance.push({ path: m.path, title: m.title, props: m.props ?? {}, content, type });
    }
    // Bills rows read with the notes down the one path (bills as one list, 8 Nov 2026): Today, Money, the
    // bell, search and the tools all read through here. Index-only, never the disk: a gated index an agent
    // may not read holds no list text, so its rows stay out the same way its notes do.
    try {
      const rel = tableRel(moduleFolder('finance', await this.areas()));
      const text = index.content(rel);
      if (text !== undefined && isBillsTableText(text)) {
        for (const n of rowsAsBillNotes(readBillsTable(text), rel, finance, (r) => index.get(r) !== undefined).notes) finance.push(n);
      }
    } catch {
      // No list, or a half-written one: the notes read as they always did.
    }
    return { finance, documents };
  }

  /** What the Bills list and its move need (src/main/bills-tables.ts, bills-move.ts). */
  billsWork(): BillsWork {
    return {
      root: this.d.vault().root,
      index: this.d.index,
      writeNote: (rel, text) => this.d.writeNote(rel, text),
      requireCreate: () => this.d.requireCreate(),
      areas: () => this.areas(),
      today: () => this.today(),
      options: () => this.options(),
      setFinanceSettings: (patch) => this.setFinanceSettings(patch),
      billNotes: async () => (await this.notesOf(this.d.index)).finance.filter((n) => n.type === 'bill' && !splitBillRow(n.path)),
      newNote: (folder, name, text) => this.newNote(folder, name, text),
      filesOf: (note) => this.filesOf(note),
      ...(this.d.dataDir ? { dataDir: this.d.dataDir } : {}),
      ...(this.d.device ? { device: this.d.device } : {}),
      ...(this.d.appVersion ? { appVersion: this.d.appVersion } : {}),
    };
  }

  /** Money's own settings changed (the Bills move's flag among them), kept in the vault's options file. */
  private async setFinanceSettings(patch: Record<string, string | number | boolean>): Promise<void> {
    await this.d.requireCreate();
    const next = withModuleOptions(await this.options(), 'finance', { settings: patch });
    const file = path.join(this.d.vault().root, ...MODULE_OPTIONS_FILE.split('/'));
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, writeModuleOptions(next), 'utf8').catch(() => undefined);
  }

  async finance(): Promise<FinanceModel & { currency: string; remindDays: number; folder: string; forecast: ReturnType<typeof financeForecast>; income: ReturnType<typeof incomeFromSettings>; billsMove: BillsMoveState; billsConflicts: BillsConflict[] }> {
    const { finance } = await this.notesOf(this.d.index);
    const o = await this.options();
    const model = financeModel(finance, this.today());
    const billsConflicts: BillsConflict[] = [];
    // A note its row points at keeps the row's path, so a page opened from the row finds it.
    try {
      const rel = tableRel(moduleFolder('finance', await this.areas()));
      const text = this.d.index.content(rel);
      if (text !== undefined && isBillsTableText(text)) {
        const doc = readBillsTable(text);
        const byNote = new Map<string, string>();
        for (const row of doc.rows) if (row.note) byNote.set(row.note, rowPathIn(doc.rows, rel, row.name));
        for (const b of model.bills) {
          const rp = byNote.get(b.path);
          if (rp) b.rowPath = rp;
        }
        // A bill changed on both PCs keeps each version, as the Systems lists do, for its page to choose.
        for (const dupe of doc.dupes) {
          const kept = doc.rows.find((r) => billNameKey(r.name) === billNameKey(dupe));
          const others = doc.conflicts[billNameKey(dupe)] ?? [];
          if (kept && others.length) billsConflicts.push({ name: kept.name, path: rowPathIn(doc.rows, rel, kept.name), kept: kept.cells, keptNote: kept.note, others: others.map((x) => ({ name: x.name, cells: x.cells, note: x.note })) });
        }
      }
    } catch {
      // No list, or a half-written one: the notes read as they always did.
    }
    const income = incomeFromSettings(o.finance?.settings);
    return { ...model, currency: currencyOf(o), remindDays: remindDaysOf(o, 'finance'), folder: typeFolder('bill', await this.areas()).replace(/\/Bills$/, ''), forecast: financeForecast(model, { days: 90, income }), income, billsMove: await billsMoveState(this.billsWork()), billsConflicts };
  }

  /** Money for the morning brief (10.0 v2money): due bills and prices under the bills part, spending over usual
   *  under the spending part, the 30-day tight sentence under the bills part (10.0 v10money). Null when off. */
  async briefMoney(): Promise<BriefMoney | null> {
    if (!this.on().includes('finance')) return null;
    const m = await this.finance();
    const bills = this.part('finance', 'bills') ? m.bills.filter((b) => b.next).map((b) => ({ path: b.path, name: b.name, amount: b.amount, next: b.next, days: b.days, overdue: b.overdue, autopay: b.autopay, paid: b.paid })) : [];
    const prices = this.part('finance', 'bills') ? m.priceChanges.filter((b) => b.change && b.change.to > b.change.from).map((b) => ({ path: b.path, name: b.name, from: b.change!.from, to: b.change!.to, date: b.change!.date })) : [];
    const over = this.part('finance', 'spending') ? spendingOverUsual(m).map((o) => ({ ...o, path: m.spending.find((s) => s.date.startsWith(o.month))?.path ?? null })) : [];
    const tight = this.part('finance', 'bills') ? tightMonthWords(financeForecast(m, { days: 30, income: m.income }), m.currency, m.today) : null;
    return { currency: m.currency, today: m.today, remindDays: m.remindDays, bills, over, prices, tight };
  }

  /** Each document's files: those in its Files folder (src/shared/file-records.ts), newest first. */
  private async filesOf(note: string): Promise<string[]> {
    const dir = filesFolderFor(note);
    try {
      const entries = await fsp.readdir(path.join(this.d.vault().root, ...dir.split('/')), { withFileTypes: true });
      const out: { rel: string; mtime: number }[] = [];
      for (const e of entries) {
        if (!e.isFile() || e.name.startsWith('.')) continue;
        const st = await fsp.stat(path.join(this.d.vault().root, ...dir.split('/'), e.name)).catch(() => null);
        out.push({ rel: `${dir}/${e.name}`, mtime: st?.mtimeMs ?? 0 });
      }
      return out.sort((a, b) => b.mtime - a.mtime).map((x) => x.rel);
    } catch {
      return [];
    }
  }

  async documents(): Promise<DocumentsModel & { remindDays: number; folder: string }> {
    const { documents } = await this.notesOf(this.d.index);
    for (const n of documents) n.files = await this.filesOf(n.path);
    const o = await this.options();
    return { ...documentsModel(documents, this.today(), remindDaysOf(o, 'documents')), remindDays: remindDaysOf(o, 'documents'), folder: typeFolder('id-document', await this.areas()) };
  }

  // ── Writing ──────────────────────────────────────────────────────────────────────────────────────────────────────

  private async freeNote(folder: string, name: string): Promise<string> {
    const v = this.d.vault();
    const base = safeFileName(name);
    for (let i = 1; i < 1000; i++) {
      const rel = `${folder ? `${folder}/` : ''}${i === 1 ? base : `${base} ${i}`}.md`;
      if (!(await v.any(rel))) return rel;
    }
    throw new Error('No free name was found for that note.');
  }
  private async newNote(folder: string, name: string, text: string): Promise<string> {
    await this.d.requireCreate();
    const rel = await this.freeNote(folder, name);
    await this.d.writeNote(rel, text);
    return rel;
  }
  private need(id: string): void {
    if (!this.on().includes(id)) throw new Error(id === 'finance' ? 'Money is switched off (Settings › Packs).' : 'Papers is switched off (Settings › Packs).');
  }
  private noteText(rel: string): string {
    const t = this.d.index.content(rel);
    if (t === undefined) throw new Error('That note isn’t there any more.');
    return t;
  }

  /** A record of this name already in its folder (any case, spacing or punctuation): adding it again would make a
   *  "Name 2" that drifts. Explicit adds refuse with where it is; the agent tools update it instead. */
  private clash(folder: string, name: string): string | null {
    const want = `${folder}/`.toLowerCase();
    for (const m of this.d.index.allMeta()) {
      if (!m.path.toLowerCase().startsWith(want) || !/\.md$/i.test(m.path)) continue;
      if (sameRecordName(m.path.slice(want.length).replace(/\.md$/i, ''), name)) return m.path;
    }
    return null;
  }

  async addBill(input: BillInput): Promise<string> {
    this.need('finance');
    const name = String(input?.name ?? '').trim().slice(0, 80);
    if (!name) throw new Error('A bill needs a name.');
    const folder = typeFolder('bill', await this.areas());
    const at = this.clash(folder, String(input.name));
    if (at) throw new Error(`There’s already a bill called ${name} [${at}]. Change it where it shows.`);
    // New bills are rows in the one list (8 Nov 2026), never notes — from every door that adds one.
    const w = this.billsWork();
    const existing = await readBills(w).catch(() => null);
    const dupe = existing?.doc.rows.find((r) => sameRecordName(r.name, name));
    if (dupe && existing) throw new Error(`There’s already a bill called ${name} [${rowPathIn(existing.doc.rows, existing.rel, dupe.name)}]. Change it where it shows.`);
    const amount = readMoney(input.amount);
    const amountSaid = input.amount as unknown;
    if (typeof amountSaid === 'string' && amountSaid.trim() && amount === null) throw new Error('Give an amount.');
    const due = input.due ? readIsoDay(input.due) : null;
    if (input.due && !due) throw new Error('Give a day.');
    const category = String(input.category ?? 'Other').trim().slice(0, 80) || 'Other';
    const cleanLink = (v: unknown) => {
      const s = String(v ?? '').trim().replace(/^\[\[|\]\]$/g, '');
      return s ? `[[${s.slice(0, 120)}]]` : '';
    };
    return addBillsRow(w, {
      name,
      cells: {
        kind: input.kind ?? (category === 'Subscriptions' ? 'Subscription' : 'Bill'),
        amount: amount === null ? '' : amount.toFixed(2),
        cycle: readCycle(input.cycle ?? 'Monthly'),
        due: due ?? '',
        category,
        account: cleanLink(input.account),
        project: cleanLink(input.project),
        autopay: input.autopay === true ? 'Yes' : 'No',
        status: 'Active',
        paid: '',
      },
      note: null,
    });
  }

  /** Words typed on a bill: on a row they make it a note of its own (the row keeps pointing at it). */
  async noteWords(rel: string, words: string): Promise<string> {
    this.need('finance');
    const text = String(words ?? '').trim().slice(0, 2000);
    if (!text) throw new Error('Write something first.');
    const row = splitBillRow(rel);
    if (row) {
      const hit = await billRowByPath(this.billsWork(), rel);
      if (!hit) throw new Error('That bill isn’t in the list any more.');
      if (hit.row.note) return this.noteWords(hit.row.note, words);
      return promoteToBillNote(this.billsWork(), hit.row.name, { notesWords: text });
    }
    await this.d.writeNote(rel, appendUnder(this.noteText(rel), [text], 'Notes'));
    return rel;
  }

  /** A bill row taken out of the list (a note is taken out from its note, as always). */
  async removeBill(rel: string): Promise<string> {
    this.need('finance');
    const row = splitBillRow(rel);
    if (!row) throw new Error('Take it out from its note.');
    const hit = await billRowByPath(this.billsWork(), rel);
    if (!hit) throw new Error('That bill isn’t in the list any more.');
    if (hit.row.note) throw new Error(`${hit.row.name} is a note of its own now. Take it out from its note.`);
    await dropBillsRows(this.billsWork(), [hit.row.name]);
    return `Took ${hit.row.name} out of the list. The list keeps its history (File recovery).`;
  }

  async addAccount(input: { name: string; institution?: string; kind?: string; holder?: string; number?: string; balance?: number | null }): Promise<string> {
    this.need('finance');
    if (!String(input?.name ?? '').trim()) throw new Error('An account needs a name.');
    const folder = typeFolder('bank-account', await this.areas());
    const at = this.clash(folder, String(input.name));
    if (at) throw new Error(`There’s already an account called ${String(input.name).trim()} [${at}]. Change it where it shows.`);
    // Only a locked link may be kept as its number: a number itself belongs in Secrets.
    const number = input.number && secretIdsIn(input.number).length ? input.number : undefined;
    return this.newNote(folder, String(input.name).trim().slice(0, 80), newAccountText({ ...input, number, balance: readMoney(input.balance) }));
  }

  async addBudget(category: string, amount: unknown, period = 'Monthly'): Promise<string> {
    this.need('finance');
    const name = String(category ?? '').trim();
    if (!name) throw new Error('A budget needs a category.');
    const folder = typeFolder('budget-category', await this.areas());
    if (this.clash(folder, name)) throw new Error(`There’s already a budget for ${name}. Change its amount where it shows.`);
    return this.newNote(folder, name, newBudgetText(readMoney(amount), /week/i.test(period) ? 'Weekly' : /year/i.test(period) ? 'Yearly' : 'Monthly'));
  }

  /** Payments added to their months' Spending notes (made as needed), each in date order. A row already there (the
   *  same day, amount and merchant words) is not added again: a retry, a double mark or a later import never doubles
   *  one. A month that fails says so with the rest still written. */
  async addSpends(rows: SpendInput[]): Promise<string[]> {
    this.need('finance');
    await this.d.requireCreate();
    const folder = typeFolder('spending-month', await this.areas());
    const byMonth = new Map<string, SpendInput[]>();
    for (const r of rows) {
      const date = readIsoDay(r.date);
      const amount = readMoney(r.amount);
      if (!date || amount === null) continue;
      // The sign stays (2 Nov 2026, money parity F3: a refund is negative, netting its category; abs made it spending).
      const clean: SpendInput = { date, what: String(r.what ?? '').slice(0, 160), category: String(r.category ?? 'Other').slice(0, 40) || 'Other', amount: Math.round(amount * 100) / 100, account: accountCellOf(r.account ?? ''), receipt: String(r.receipt ?? '').slice(0, 300) };
      byMonth.set(date.slice(0, 7), [...(byMonth.get(date.slice(0, 7)) ?? []), clean]);
    }
    const written: string[] = [];
    const failed: string[] = [];
    for (const [month, list] of byMonth) {
      const rel = `${folder}/${month}.md`;
      try {
        const text = this.d.index.content(rel) ?? (await this.read(rel)) ?? newSpendingText(month);
        const have = new Map<string, number>();
        for (const s of spendRows({ path: rel, content: text })) {
          const k = spendDedupeKey(s.date, s.amount, s.what);
          have.set(k, (have.get(k) ?? 0) + 1);
        }
        const seen = new Map<string, number>();
        const fresh = list.filter((r) => {
          const k = spendDedupeKey(r.date, r.amount, r.what);
          const n = (seen.get(k) ?? 0) + 1;
          seen.set(k, n);
          return n > (have.get(k) ?? 0);
        });
        if (!fresh.length) {
          written.push(rel);
          continue;
        }
        await this.d.writeNote(rel, withSpendRows(text, fresh));
        written.push(rel);
      } catch (e) {
        failed.push(`${month} (${e instanceof Error ? e.message : String(e)})`);
      }
    }
    if (failed.length && !written.length) throw new Error(`Nothing was added: ${failed.join('; ')}.`);
    if (failed.length) throw new Error(`Added to ${written.length} ${written.length === 1 ? 'month' : 'months'}; these failed: ${failed.join('; ')}.`);
    return written;
  }

  /** One payment added by hand, its receipts (files from the PC) kept beside its month's note and named in its row. */
  async addSpendWithReceipt(row: SpendInput, files: string[]): Promise<string[]> {
    this.need('finance');
    const date = readIsoDay(row.date);
    if (!date) throw new Error('Give the day it was paid.');
    if (readMoney(row.amount) === null) throw new Error('Give how much it was.');
    let receipt = '';
    const picked = files.filter((f) => path.isAbsolute(f)).slice(0, 20);
    if (picked.length) {
      const month = `${typeFolder('spending-month', await this.areas())}/${date.slice(0, 7)}.md`;
      const kept = await this.d.importFiles(picked, filesFolderFor(month));
      if (kept[0]) receipt = kept.map((k) => `[[${k}|${path.posix.basename(k)}]]`).join(', ');
    }
    return this.addSpends([{ ...row, date, receipt }]);
  }

  /** The occurrence a payment on `day` covers. Refuses when that occurrence is already paid. */
  private paidCovered(bill: { name: string; anchor: string | null; cycle: string; paid: string | null; transfer: boolean }, day: string, today: string): string | null {
    // The occurrence this payment covers (2 Nov 2026, money parity F7): a first payment covers the latest
    // overdue (if any), else the coming one — never a prior before the anchor, never skipping the overdue.
    // Later payments use the half-window, moved to the coming one when it lands on a prior before the anchor
    // (fortnightly early), unless it's the same day as already paid (a retry, which must match to throw).
    const coveredFor = (d: string, prev: string | null): string | null => {
      if (!bill.anchor) return null;
      if (!prev) {
        const latest = latestOccurrence(bill.anchor, bill.cycle, d);
        return latest ?? firstOnOrAfter(bill.anchor, bill.cycle, d);
      }
      let now = occurrenceCoveredBy(bill.anchor, bill.cycle, d);
      if (now < bill.anchor && d !== prev) now = firstOnOrAfter(bill.anchor, bill.cycle, d);
      return now;
    };
    if (bill.anchor && bill.paid) {
      const then = occurrenceCoveredBy(bill.anchor, bill.cycle, bill.paid);
      const now = coveredFor(day, bill.paid);
      // A repayment is never spending (2 Nov 2026): a retried card or loan payment is not steered to Spending.
      if (then === now && bill.transfer) throw new Error(`${bill.name} is already marked paid for ${dueWords(now!, today)} (paid ${dueWords(bill.paid, today)}). The payment is recorded on the bill; only a genuinely second payment needs its own line in the bill's Notes.`);
      if (then === now) throw new Error(`${bill.name} is already marked paid for ${dueWords(now!, today)} (paid ${dueWords(bill.paid, today)}). To record another payment, add it to ${day.slice(0, 7)} spending.`);
    }
    return bill.anchor ? coveredFor(day, bill.paid) : null;
  }

  /** The `due:` after a payment: past the occurrence covered (the bill always shows the coming cycle). */
  private advancedDue(bill: { anchor: string | null; cycle: string }, day: string, covered: string | null): string | null {
    if (!bill.anchor) return null;
    if (bill.cycle !== 'Once' && covered) {
      const following = firstOnOrAfter(bill.anchor, bill.cycle, isoOf(new Date(new Date(Number(covered.slice(0, 4)), Number(covered.slice(5, 7)) - 1, Number(covered.slice(8, 10))).getTime() + 86_400_000)));
      return following > day ? following : bill.anchor;
    }
    if (bill.cycle === 'Once') return bill.anchor;
    return advanceAnchor(bill.anchor, bill.cycle, day);
  }

  /** A bill's note with a payment on `day` committed: `paid:` set and `due:` moved past the occurrence it covers, in
   *  one write (the note always shows the coming cycle). Refuses when that occurrence is already paid. */
  private commitPaid(text: string, bill: { name: string; anchor: string | null; cycle: string; paid: string | null; transfer: boolean }, day: string, today: string): { text: string; covered: string | null } {
    const covered = this.paidCovered(bill, day, today);
    let next = setNoteProp(text, 'paid', day);
    const due = this.advancedDue(bill, day, covered);
    if (due) next = setNoteProp(next, 'due', due);
    return { text: next, covered };
  }

  /** A bill paid on a day (today unless given): its `paid:` set and its `due:` moved to the coming cycle, one line in
   *  its Notes, and the payment added to that month's spending — a card or loan repayment as a Transfers row
   *  (recorded, never counted; 2 Nov 2026, money parity F5: hand and import leave the same trace). Paid early
   *  for an autopay day, the cycle is said to be covered, on the bill as well as in the answer. */
  async markPaid(rel: string, day?: string, addSpend = true, account?: string, amount?: number | null): Promise<string> {
    this.need('finance');
    if (splitBillRow(rel)) return this.markRowPaid(rel, day, addSpend, account, amount);
    const text = this.noteText(rel);
    const m = financeModel([{ path: rel, title: path.posix.basename(rel, '.md'), props: this.d.index.get(rel)?.props ?? {}, content: text, type: 'bill' }], this.today());
    const bill = m.bills[0];
    const date = (day && readIsoDay(day)) || isoOf(this.today());
    const transfer = isTransferBill(bill.category);
    // A retry says already paid, never throws (2 Nov 2026, money parity F9: a double-tap failed instead of
    // succeeding with words). No second write, no second line: the guard in commitPaid still prevents doubling.
    let committed: string;
    let covered: string | null;
    try {
      ({ text: committed, covered } = this.commitPaid(text, { ...bill, transfer }, date, isoOf(this.today())));
    } catch (e) {
      if (e instanceof Error && /already marked paid/.test(e.message)) return e.message;
      throw e;
    }
    // The amount the person gave wins over the bill's (2 Nov 2026, money parity F4: "$200" was dropped for "$150").
    // A different amount moves the bill with a price-history row, the same rule as every other amount change.
    const paidAmount = amount ?? bill.amount;
    let withAmount = committed;
    if (amount !== undefined && amount !== null && amount !== bill.amount) {
      withAmount = bill.amount === null ? setNoteProp(committed, 'amount', amount) : setNoteProp(withPrice(committed, bill.amount, amount, date, 'Paid amount'), 'amount', amount);
    }
    // The payment is recorded first (9.2 fresh eyes): a failed Spending write leaves the bill unpaid and
    // retryable, and Spending rows are deduped, so the retry never doubles the row.
    if (addSpend && paidAmount !== null) await this.addSpends([{ date, what: bill.name, category: spendCategoryOfBill(bill.category), amount: paidAmount, account: account ?? bill.account ?? '' }]);
    const cur = currencyOf(await this.options());
    const today = isoOf(this.today());
    // One growing record on the bill itself (a payment said in words left the bill's Notes empty, so a
    // repayment was recorded nowhere in words). The already-paid guard above keeps it to one line per payment.
    const line = paidLine({ amount: paidAmount, autopay: bill.autopay }, date, covered, cur, today);
    await this.d.writeNote(rel, appendUnder(withAmount, [line], 'Notes'));
    const fixedDue = bill.anchor && bill.cycle !== 'Once' && covered ? (() => { const f = firstOnOrAfter(bill.anchor, bill.cycle, isoOf(new Date(new Date(Number(covered.slice(0, 4)), Number(covered.slice(5, 7)) - 1, Number(covered.slice(8, 10))).getTime() + 86_400_000))); return f > date ? f : bill.anchor; })() : bill.anchor;
    const after = financeModel([{ path: rel, title: bill.name, props: { ...(this.d.index.get(rel)?.props ?? {}), paid: date, due: fixedDue ?? undefined }, content: committed, type: 'bill' }], this.today()).bills[0];
    const parts = [`${bill.name} marked paid${paidAmount !== null ? ` (${moneyWords(paidAmount, cur)})` : ''}${transfer ? ', a transfer so not counted as spending' : ''}.`];
    if (after.next) parts.push(`Next due ${dueWords(after.next, today)}.`);
    if (bill.autopay && covered && covered > date) parts.push(`This cycle is covered: paid by hand before the autopay day ${dueWords(covered, today)}.`);
    return parts.join(' ');
  }

  /** A row bill paid: its Paid and Due cells moved, its payment in spending and in the list's own payment
   *  lines (machine words, so no note). A different amount is a price change: a first amount sets the cell,
   *  a real change makes it a note (its history runs longer than the first line). */
  private async markRowPaid(rel: string, day?: string, addSpend = true, account?: string, amount?: number | null): Promise<string> {
    const w = this.billsWork();
    const hit = await billRowByPath(w, rel);
    if (!hit) throw new Error('That bill isn’t in the list any more.');
    if (hit.row.note) return this.markPaid(hit.row.note, day, addSpend, account, amount);
    const { doc } = await readBills(w);
    const row = findBillRow(doc, hit.row.name)!;
    const m = financeModel([{ path: rel, title: row.name, props: billsRowProps(row), content: renderBillRowNote(row, doc.prices, doc.payments), type: 'bill' }], this.today());
    const bill = m.bills[0];
    const date = (day && readIsoDay(day)) || isoOf(this.today());
    const today = isoOf(this.today());
    const transfer = isTransferBill(bill.category);
    let covered: string | null;
    try {
      covered = this.paidCovered({ ...bill, transfer }, date, today);
    } catch (e) {
      if (e instanceof Error && /already marked paid/.test(e.message)) return e.message;
      throw e;
    }
    if (amount !== undefined && amount !== null && amount !== bill.amount && bill.amount !== null) {
      const made = await promoteToBillNote(w, row.name);
      return `${await this.markPaid(made, day, addSpend, account, amount)} It is a note of its own now.`;
    }
    // The payment is recorded first (a failed Spending write leaves the bill unpaid and retryable, and
    // Spending rows are deduped, so the retry never doubles the row).
    const paidAmount = amount ?? bill.amount;
    if (addSpend && paidAmount !== null) await this.addSpends([{ date, what: bill.name, category: spendCategoryOfBill(bill.category), amount: paidAmount, account: account ?? bill.account ?? '' }]);
    const cur = currencyOf(await this.options());
    const line = paidLine({ amount: paidAmount, autopay: bill.autopay }, date, covered, cur, today);
    const due = this.advancedDue({ anchor: bill.anchor, cycle: bill.cycle }, date, covered);
    const fresh = await readBills(w);
    const key = billNameKey(row.name);
    const rows = fresh.doc.rows.map((r) => (billNameKey(r.name) === key ? { ...r, cells: { ...r.cells, paid: date, ...(due ? { due } : {}), ...(paidAmount !== null && bill.amount === null ? { amount: paidAmount.toFixed(2) } : {}) } } : r));
    await writeBills(w, { ...fresh.doc, rows, payments: { ...fresh.doc.payments, [key]: [...(fresh.doc.payments[key] ?? []), line] } });
    const parts = [`${bill.name} marked paid${paidAmount !== null ? ` (${moneyWords(paidAmount, cur)})` : ''}${transfer ? ', a transfer so not counted as spending' : ''}.`];
    const after = nextDue({ anchor: due ?? bill.anchor, cycle: bill.cycle, paid: date, autopay: bill.autopay, status: bill.status }, today);
    if (after.next) parts.push(`Next due ${dueWords(after.next, today)}.`);
    if (bill.autopay && covered && covered > date) parts.push(`This cycle is covered: paid by hand before the autopay day ${dueWords(covered, today)}.`);
    return parts.join(' ');
  }

  /** One value changed where a view shows it. */
  async setField(kind: string, rel: string, field: string, value: unknown, row?: number): Promise<string | null> {
    if (!EDITABLE[kind]?.includes(field)) throw new Error('That can’t be changed here.');
    this.need(kind === 'document' ? 'documents' : 'finance');
    if (kind === 'bill' && splitBillRow(rel)) return this.setBillCell(rel, field, value);
    const text = this.noteText(rel);
    if (kind === 'spend') {
      if (typeof row !== 'number') throw new Error('That payment isn’t there any more.');
      const col = { date: 0, title: 1, category: 2, amount: 3, account: 4 }[field as 'date'];
      const words = field === 'amount' ? (readMoney(value)?.toFixed(2) ?? '') : field === 'date' ? (readIsoDay(value) ?? '') : String(value ?? '');
      if ((field === 'amount' || field === 'date') && !words) throw new Error(field === 'amount' ? 'Give an amount.' : 'Give a day.');
      await this.d.writeNote(rel, setTableCell(text, row, col, words));
      return null;
    }
    if (field === 'title') return null;
    const key = PROPERTY_OF[kind][field];
    let next = text;
    let said: string | null = null;
    if (key === 'amount' && kind === 'bill') {
      const to = readMoney(value);
      if (to === null) throw new Error('Give an amount.');
      const from = readMoney(this.d.index.get(rel)?.props?.amount);
      // A row only when one amount really replaces another (2 Nov 2026): setting the first amount is not a change.
      if (from !== null && from !== to) {
        next = withPrice(text, from, to, isoOf(this.today()), to > from ? 'Went up' : 'Went down');
        said = `The price change is kept in its history (${from.toFixed(2)} → ${to.toFixed(2)}).`;
      }
      next = setNoteProp(next, 'amount', to);
    } else if (['amount', 'balance'].includes(key)) {
      const n = value === '' || value === null ? null : readMoney(value);
      if (value !== '' && value !== null && n === null) throw new Error('Give an amount.');
      next = setNoteProp(text, key, n);
    } else if (['due', 'as_of', 'issued', 'expires'].includes(key)) {
      const d = value === '' || value === null ? null : readIsoDay(value);
      if (value !== '' && value !== null && !d) throw new Error('Give a day.');
      next = setNoteProp(text, key, d);
    } else if (key === 'autopay') next = setNoteProp(text, key, value === true || /^(yes|true)$/i.test(String(value)) ? 'Yes' : 'No');
    else if (key === 'account' || key === 'project') next = setNoteProp(text, key, String(value ?? '').trim() ? `[[${String(value).trim().replace(/^\[\[|\]\]$/g, '').slice(0, 120)}]]` : null);
    else next = setNoteProp(text, key, String(value ?? '').trim().slice(0, 120) || null);
    if (next !== text) await this.d.writeNote(rel, next);
    return said;
  }

  /** Cells changed in the Bills list (the row's own cells carry the same keys as the note's properties). */
  private async writeBillCells(name: string, patch: Record<string, string>): Promise<void> {
    const w = this.billsWork();
    const { doc } = await readBills(w);
    const key = billNameKey(name);
    await writeBills(w, { ...doc, rows: doc.rows.map((r) => (billNameKey(r.name) === key ? { ...r, cells: { ...r.cells, ...patch } } : r)) });
  }

  /** One value changed where a view shows it, on a row: plain fixes stay in the row, while a real price
   *  change makes it a note (its history runs longer than the first line). */
  private async setBillCell(rel: string, field: string, value: unknown): Promise<string | null> {
    if (field === 'title') return null;
    const key = PROPERTY_OF.bill[field];
    const w = this.billsWork();
    const hit = await billRowByPath(w, rel);
    if (!hit) throw new Error('That bill isn’t in the list any more.');
    if (hit.row.note) return this.setField('bill', hit.row.note, field, value);
    const { doc } = await readBills(w);
    const row = findBillRow(doc, hit.row.name)!;
    if (key === 'amount') {
      const to = readMoney(value);
      if (to === null) throw new Error('Give an amount.');
      const from = readMoney(row.cells.amount || null);
      // A row only when one amount really replaces another: setting the first amount is not a change.
      if (from !== null && from !== to) {
        const made = await promoteToBillNote(w, row.name);
        await this.setField('bill', made, 'amount', to);
        return `The price change is kept in its history (${from.toFixed(2)} → ${to.toFixed(2)}). It is a note of its own now.`;
      }
      if ((row.cells.amount || '') !== to.toFixed(2)) await this.writeBillCells(row.name, { amount: to.toFixed(2) });
      return null;
    }
    let words: string;
    if (key === 'due') {
      const d = value === '' || value === null ? null : readIsoDay(value);
      if (value !== '' && value !== null && !d) throw new Error('Give a day.');
      words = d ?? '';
    } else if (key === 'autopay') words = value === true || /^(yes|true)$/i.test(String(value)) ? 'Yes' : 'No';
    else if (key === 'account' || key === 'project') words = String(value ?? '').trim() ? `[[${String(value).trim().replace(/^\[\[|\]\]$/g, '').slice(0, 120)}]]` : '';
    else words = String(value ?? '').trim().slice(0, 120);
    if ((row.cells[key] ?? '') !== words) await this.writeBillCells(row.name, { [key]: words });
    return null;
  }

  /** A document's or account's number set to a locked link (the secret made in Secrets by the window first). */
  async setNumber(rel: string, link: string): Promise<void> {
    if (!secretIdsIn(link).length) throw new Error('Only a locked link to Secrets can be kept as a number.');
    await this.d.writeNote(rel, setNoteProp(this.noteText(rel), 'number', link));
  }

  async addDocument(input: DocumentInput & { name?: string }): Promise<string> {
    this.need('documents');
    const number = input.number && secretIdsIn(input.number).length ? input.number : undefined;
    const kind = String(input.kind ?? 'Other').slice(0, 40) || 'Other';
    const name = String(input.name ?? '').trim() || documentName({ kind, holder: input.holder, version: input.version });
    const folder = typeFolder('id-document', await this.areas());
    const at = this.clash(folder, name);
    if (at) throw new Error(`There’s already ${name} in Papers [${at}]. A renewal goes through Renew, not a new note.`);
    return this.newNote(folder, name, newDocumentText({ ...input, kind, number, issued: input.issued ? readIsoDay(input.issued) : null, expires: input.expires ? readIsoDay(input.expires) : null }));
  }

  /** A document renewed (30 Oct 2026, 8.3 wave 1): a new copy with the new expiry is made beside the old one, and the
   *  old copy is kept with the renewal noted in it. Nothing is deleted. */
  async renewDocument(rel: string, expires: string, issued?: string): Promise<string> {
    this.need('documents');
    const expiresDay = readIsoDay(expires);
    if (!expiresDay) throw new Error('Give the new expiry day.');
    const issuedDay = issued ? readIsoDay(issued) : null;
    if (issued && !issuedDay) throw new Error('Give the day it was issued.');
    const text = this.noteText(rel);
    const meta = this.d.index.get(rel);
    const doc = documentsModel([{ path: rel, title: meta?.title ?? path.posix.basename(rel, '.md'), props: meta?.props ?? {}, content: text }], this.today()).documents[0];
    const number = String(meta?.props?.number ?? '');
    const secretLink = secretIdsIn(number).length ? number : null;
    const folder = typeFolder('id-document', await this.areas());
    // "Passport (Mia Harris), to 2036": the new copy says how long it runs (the old title read "(renewed 2036)").
    const base = doc.name.replace(/,\s*to \d{4}$/, '');
    const { newText } = renewedDocumentTexts({ name: doc.name, kind: doc.kind, holder: doc.holder, issuer: doc.issuer, secretLink, oldText: text, oldExpires: doc.expires }, { expires: expiresDay, issued: issuedDay, today: isoOf(this.today()) });
    const made = await this.newNote(folder, `${base}, to ${expiresDay.slice(0, 4)}`, newText);
    const { oldText } = renewedDocumentTexts({ name: doc.name, kind: doc.kind, holder: doc.holder, issuer: doc.issuer, secretLink, oldText: text, oldExpires: doc.expires }, { expires: expiresDay, issued: issuedDay, today: isoOf(this.today()), newName: path.posix.basename(made, '.md') });
    if (oldText !== text) await this.d.writeNote(rel, oldText);
    return made;
  }

  /** Files from the PC chosen to keep with a record (a receipt, a scan). */
  pickFiles(title: string): Promise<string[]> {
    const test = devSwitch('NV_TEST_ATTACH_FILES');
    if (test) return Promise.resolve(test.split(path.delimiter).filter(Boolean));
    return this.d.pickFiles({ title: title || 'Choose files to keep with it', button: 'Keep with it', many: true });
  }

  /** Files kept with a record (copied beside it, its Files folder), and the note given a link to each. For a payment
   *  (row given) the first file is written in its Receipt cell. */
  async attach(rel: string, files: string[], row?: number): Promise<string[]> {
    await this.d.requireCreate();
    if (splitBillRow(rel)) {
      // Files kept with it are the person's: the row becomes a note first, and they go beside it.
      const hit = await billRowByPath(this.billsWork(), rel).catch(() => null);
      if (hit) rel = hit.row.note ?? (await promoteToBillNote(this.billsWork(), hit.row.name));
    }
    const added = await this.d.importFiles(files.filter((f) => typeof f === 'string' && path.isAbsolute(f)).slice(0, 20), filesFolderFor(rel));
    if (!added.length) return added;
    let text = this.noteText(rel);
    if (typeof row === 'number') text = setTableCell(text, row, 5, `[[${added[0]}|${path.posix.basename(added[0])}]]`);
    else {
      const lines = added.map((a) => `- ![[${a}|${path.posix.basename(a)}]]`);
      const at = /^##\s+files\s*$/im.exec(text);
      if (at) {
        const end = text.indexOf('\n', at.index);
        text = `${text.slice(0, end + 1)}\n${lines.join('\n')}${text.slice(end + 1)}`;
      } else text = `${text.replace(/\s*$/, '')}\n\n## Files\n\n${lines.join('\n')}\n`;
    }
    await this.d.writeNote(rel, text);
    return added;
  }

  // ── A bank's CSV ─────────────────────────────────────────────────────────────────────────────────────────────────

  /** The person picks their bank's CSV; its words come back to be read (nothing is added until they say). */
  async pickCsv(): Promise<{ name: string; text: string } | null> {
    this.need('finance');
    const test = devSwitch('NV_TEST_BANK_CSV');
    const file = test || (await this.d.pickFiles({ title: 'Import your bank’s transactions (CSV)', button: 'Import', filters: [{ name: 'CSV (bank export)', extensions: ['csv', 'txt'] }] }))[0];
    if (!file) return null;
    const st = await fsp.stat(file);
    if (st.size > MAX_CSV) throw new Error('That file is larger than 20 MB. Export a shorter time span and import each one.');
    return { name: path.basename(file), text: await fsp.readFile(file, 'utf8') };
  }

  async importPlan(text: unknown): Promise<ImportPlan> {
    this.need('finance');
    if (typeof text !== 'string' || !text.trim()) return { rows: [], moneyIn: 0, read: '', newBills: [], priceChanges: [], paid: [], problem: 'That file is empty.' };
    if (text.length > MAX_CSV) return { rows: [], moneyIn: 0, read: '', newBills: [], priceChanges: [], paid: [], problem: 'That file is larger than 20 MB. Export a shorter time span and import each one.' };
    const m = await this.finance();
    const o = await this.options();
    const table = parseCsv(text);
    const plan = planBankImport(table, m, this.today(), cleanBankProfiles(o.finance?.bankProfiles ?? {}));
    // Remember this bank's columns for next time (its header's key), in the vault's own options file.
    const cols = plan.problem ? null : bankColumns(table, cleanBankProfiles(o.finance?.bankProfiles ?? {}));
    if (cols?.header) {
      const next = withModuleOptions(o, 'finance', { bankProfiles: withBankProfile(o.finance?.bankProfiles, table, cols) });
      const file = path.join(this.d.vault().root, ...MODULE_OPTIONS_FILE.split('/'));
      await fsp.mkdir(path.dirname(file), { recursive: true }).catch(() => undefined);
      await fsp.writeFile(file, writeModuleOptions(next), 'utf8').catch(() => undefined);
    }
    return plan;
  }

  /** A row bill's payment committed by an import: its Paid and Due cells moved, one line in the list's own
   *  payment lines (the bank's row was added above, so no spending here). Refuses when already paid. */
  private async rowPaidNoSpend(rel: string, day: string, cur: string, today: string): Promise<void> {
    const w = this.billsWork();
    const hit = await billRowByPath(w, rel);
    if (!hit) throw new Error('That bill isn’t in the list any more.');
    if (hit.row.note) {
      const t = this.d.index.content(hit.row.note);
      if (t === undefined) throw new Error('That bill isn’t there any more.');
      const b = financeModel([{ path: hit.row.note, title: hit.row.name, props: this.d.index.get(hit.row.note)?.props ?? {}, content: t, type: 'bill' }], this.today()).bills[0];
      const { text, covered } = this.commitPaid(t, { ...b, transfer: isTransferBill(b.category) }, day, today);
      await this.d.writeNote(hit.row.note, appendUnder(text, [paidLine(b, day, covered, cur, today)], 'Notes'));
      return;
    }
    const { doc } = await readBills(w);
    const row = findBillRow(doc, hit.row.name)!;
    const b = financeModel([{ path: rel, title: row.name, props: billsRowProps(row), content: renderBillRowNote(row, doc.prices, doc.payments), type: 'bill' }], this.today()).bills[0];
    const covered = this.paidCovered({ ...b, transfer: isTransferBill(b.category) }, day, today);
    const due = this.advancedDue({ anchor: b.anchor, cycle: b.cycle }, day, covered);
    const key = billNameKey(row.name);
    const rows = doc.rows.map((r) => (billNameKey(r.name) === key ? { ...r, cells: { ...r.cells, paid: day, ...(due ? { due } : {}) } } : r));
    await writeBills(w, { ...doc, rows, payments: { ...doc.payments, [key]: [...(doc.payments[key] ?? []), paidLine(b, day, covered, cur, today)] } });
  }

  /** A row bill's amount brought up to date by an import: the same amount again writes nothing, a first
   *  amount sets the cell with no history row, and a real change makes it a note (its history runs longer
   *  than the first line). True when something moved. */
  private async rowPriceTo(rel: string, to: number, day: string): Promise<boolean> {
    const w = this.billsWork();
    const hit = await billRowByPath(w, rel).catch(() => null);
    if (!hit) return false;
    if (hit.row.note) {
      const t = this.d.index.content(hit.row.note);
      if (t === undefined) return false;
      const from = readMoney(this.d.index.get(hit.row.note)?.props?.amount);
      if (from === to) return false;
      const next = from === null ? setNoteProp(t, 'amount', to) : setNoteProp(withPrice(t, from, to, day, 'From the bank’s CSV'), 'amount', to);
      if (next === t) return false;
      await this.d.writeNote(hit.row.note, next);
      return true;
    }
    const { doc } = await readBills(w).catch(() => null as never);
    if (!doc) return false;
    const row = findBillRow(doc, hit.row.name);
    if (!row) return false;
    const from = readMoney(row.cells.amount || null);
    if (from === to) return false;
    if (from === null) {
      await this.writeBillCells(row.name, { amount: to.toFixed(2) });
      return true;
    }
    const made = await promoteToBillNote(w, row.name);
    const t = this.noteText(made);
    await this.d.writeNote(made, setNoteProp(withPrice(t, from, to, day, 'From the bank’s CSV'), 'amount', to));
    return true;
  }

  /** The import as chosen: the rows (categories as the person left them), bills marked paid, prices changed, new bills.
   *  Each part lands on its own: one bad row, bill or month never stops the rest, and the words say what landed. */
  async importApply(choice: { rows: { date: string; what: string; amount: number; category: string }[]; account?: string; paid?: { bill: string; date: string }[]; prices?: { bill: string; to: number; date: string }[]; bills?: BillInput[] }): Promise<string> {
    this.need('finance');
    const rows = (choice?.rows ?? []).slice(0, 20000);
    let written: string[] = [];
    let partial = '';
    try {
      written = await this.addSpends(rows.map((r) => ({ ...r, account: choice.account ?? '' })));
    } catch (e) {
      partial = e instanceof Error ? e.message : String(e);
    }
    let paid = 0;
    let already = 0;
    let payFailed = 0;
    const cur = currencyOf(await this.options());
    const today = isoOf(this.today());
    for (const p of (choice.paid ?? []).slice(0, 500)) {
      if (splitBillRow(p.bill)) {
        // The bank's row lands above; the bill's own payment is committed below, never as spending.
        try {
          await this.rowPaidNoSpend(p.bill, readIsoDay(p.date) ?? isoOf(this.today()), cur, today);
          paid++;
        } catch (e) {
          if (e instanceof Error && /already paid/.test(e.message)) already++;
          else payFailed++;
        }
        continue;
      }
      const t = this.d.index.content(p.bill);
      if (t === undefined) {
        payFailed++;
        continue;
      }
      try {
        const b = financeModel([{ path: p.bill, title: path.posix.basename(p.bill, '.md'), props: this.d.index.get(p.bill)?.props ?? {}, content: t, type: 'bill' }], this.today()).bills[0];
        const day = readIsoDay(p.date) ?? isoOf(this.today());
        const { text, covered } = this.commitPaid(t, { ...b, transfer: isTransferBill(b.category) }, day, today);
        await this.d.writeNote(p.bill, appendUnder(text, [paidLine(b, day, covered, cur, today)], 'Notes'));
        paid++;
      } catch (e) {
        // Already marked paid for that occurrence (by hand, then the CSV): the bank's row still lands above.
        if (e instanceof Error && /already paid/.test(e.message)) already++;
        else payFailed++;
      }
    }
    let prices = 0;
    for (const p of (choice.prices ?? []).slice(0, 500)) {
      const to = readMoney(p.to);
      if (to === null) continue;
      if (splitBillRow(p.bill)) {
        if (await this.rowPriceTo(p.bill, to, readIsoDay(p.date) ?? isoOf(this.today()))) prices++;
        continue;
      }
      const t = this.d.index.content(p.bill);
      if (t === undefined) continue;
      const from = readMoney(this.d.index.get(p.bill)?.props?.amount);
      // A row only when the amount really changed (2 Nov 2026): the same amount again writes nothing, and a first
      // amount sets the property with no row.
      if (from === to) continue;
      const next = from === null ? setNoteProp(t, 'amount', to) : setNoteProp(withPrice(t, from, to, readIsoDay(p.date) ?? isoOf(this.today()), 'From the bank’s CSV'), 'amount', to);
      if (next === t) continue;
      await this.d.writeNote(p.bill, next);
      prices++;
    }
    let made = 0;
    let skipped = 0;
    for (const b of (choice.bills ?? []).slice(0, 100)) {
      try {
        await this.addBill(b);
        made++;
      } catch {
        skipped++;
      }
    }
    const parts = [
      partial || `${rows.length} ${rows.length === 1 ? 'payment' : 'payments'} added to ${written.length} ${written.length === 1 ? 'month' : 'months'}`,
      paid ? `${paid} ${paid === 1 ? 'bill' : 'bills'} marked paid` : '',
      already ? `${already} already paid` : '',
      payFailed ? `${payFailed} ${payFailed === 1 ? 'bill' : 'bills'} could not be marked paid` : '',
      prices ? `${prices} ${prices === 1 ? 'price' : 'prices'} brought up to date` : '',
      made ? `${made} new ${made === 1 ? 'bill' : 'bills'}` : '',
      skipped ? `${skipped} ${skipped === 1 ? 'bill' : 'bills'} already there, left as ${skipped === 1 ? 'it was' : 'they were'}` : '',
    ].filter(Boolean);
    return `${parts.join(', ')}.`;
  }

  // ── Notices: bills due, spending over usual, prices changed, documents expiring ──────────────────────────────────

  async check(): Promise<number> {
    const on = this.on();
    if (!on.length) return 0;
    const items: { key: string; kind: string; title: string; body: string; path: string }[] = [];
    if (on.includes('finance') && this.part('finance', 'bills')) {
      const m = await this.finance();
      for (const b of m.bills) {
        if (!b.next || b.days === null) continue;
        const ahead = b.days <= m.remindDays && b.days >= 0;
        const lateAuto = b.overdue && b.autopay;
        if (ahead || b.overdue) {
          // The same words the morning brief uses (10.0 v2money), except an autopay debit that may not have gone
          // through, which keeps its own title: it needs checking, not just paying.
          if (lateAuto) items.push({ key: `bill:${b.path}:${b.next}:late`, kind: 'finance', title: `${b.name} may not have gone through`, body: `${b.amount !== null ? moneyWords(b.amount, m.currency) : 'No amount written'} · ${dueWords(b.next, m.today)} · autopay, not confirmed`, path: b.path });
          else {
            const said = billDueWords(b, m.currency, m.today);
            items.push({ key: `bill:${b.path}:${b.next}${b.overdue ? ':late' : ''}`, kind: 'finance', title: said.title, body: said.detail, path: b.path });
          }
        }
        if (b.change?.recent) {
          const up = priceUpWords(b, m.currency, m.today);
          if (up) items.push({ key: `price:${b.path}:${b.change.date}:${b.change.to}`, kind: 'finance', title: up.title, body: up.detail, path: b.path });
          else items.push({ key: `price:${b.path}:${b.change.date}:${b.change.to}`, kind: 'finance', title: `${b.name} went down`, body: `${moneyWords(b.change.from, m.currency)} to ${moneyWords(b.change.to, m.currency)}${b.change.date ? ` from ${dueWords(b.change.date, m.today)}` : ''}`, path: b.path });
        }
      }
      // The next 30 days look tight (10.0 v10money): the same sentence the brief carries, said once per tight week.
      const tight = tightMonthWords(financeForecast(m, { days: 30, income: m.income }), m.currency, m.today);
      if (tight) items.push({ key: `tight:${tight.week}`, kind: 'finance', title: tight.title, body: tight.detail, path: tight.path });
    }
    // Spending in a category well over its usual (10.0 v2money): the same words the brief uses. Said once per
    // category and month, like every other notice. Under the spending part, like the budgets it stands beside.
    if (on.includes('finance') && this.part('finance', 'spending')) {
      const m = await this.finance();
      for (const o of spendingOverUsual(m)) {
        const said = spendOverWords(o, m.currency);
        const monthPath = m.spending.find((s) => s.date.startsWith(o.month))?.path ?? '';
        items.push({ key: `spend:${o.category}:${o.month}`, kind: 'finance', title: said.title, body: said.detail, path: monthPath });
      }
    }
    if (on.includes('documents')) {
      const m = await this.documents();
      for (const doc of m.expiring) items.push({ key: `doc:${doc.path}:${doc.expires}:${doc.status}`, kind: 'documents', title: doc.status === 'Expired' ? `${doc.name} has expired` : `${doc.name} expires ${doc.days === 0 ? 'today' : `in ${doc.days} days`}`, body: `${doc.kind}${doc.holder ? ` · ${doc.holder}` : ''} · ${doc.expires ? dueWords(doc.expires, m.today) : ''}`, path: doc.path });
    }
    return items.length ? this.d.post(items) : 0;
  }

  /** Checking every ten minutes while a module is on (the first a moment after the notes open). */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.check().catch((e) => this.d.log?.(`modules check: ${e instanceof Error ? e.message : String(e)}`)), CHECK_MS);
    this.timer.unref?.();
    setTimeout(() => void this.check().catch(() => undefined), 8000).unref?.();
  }
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  // ── The Inbox: an emailed bill filed as a bill ───────────────────────────────────────────────────────────────────

  /** What an Inbox item would be as a bill (the bill of that name updated, or a new one), when it reads as one. */
  async inboxBill(item: Pick<InboxItem, 'words' | 'kind' | 'path'>): Promise<{ name: string; amount: number; due: string | null; existing?: string } | null> {
    try {
      return await this.inboxBillMatch(item);
    } catch {
      return null;
    }
  }

  private async inboxBillMatch(item: Pick<InboxItem, 'words' | 'kind' | 'path'>): Promise<{ name: string; amount: number; due: string | null; existing?: string } | null> {
    if (!this.on().includes('finance')) return null;
    const words = item.kind === 'file' ? path.posix.basename(item.path).replace(/[_-]+/g, ' ') + ' ' + item.words : item.words;
    const b = billFromWords(words, this.today());
    if (!b) return null;
    const m = financeModel((await this.notesOf(this.d.index)).finance, this.today());
    // The exact bill first; two close names never silently the first — filing names them to choose from.
    let existing: { path: string; name: string } | undefined;
    try {
      existing = resolveOne(m.bills, b.name, { noun: 'bill', where: 'in Money' });
    } catch (e) {
      if (e instanceof Error && /More than one/.test(e.message)) throw e;
      existing = undefined;
    }
    return { ...b, ...(existing ? { existing: existing.path, name: existing.name } : {}) };
  }

  /** A record's note updated in place from planned fields (an agent's add that names one already there, an emailed
   *  bill): only the fields given move, and a changed bill amount is kept in its price history with the note given. */
  private async applyUpdate(kind: 'bill' | 'account' | 'budget', rel: string, fields: Record<string, unknown>, note: string): Promise<boolean> {
    if (kind === 'bill' && splitBillRow(rel)) return this.applyBillRowUpdate(rel, fields, note);
    let text = this.noteText(rel);
    const start = text;
    const props = this.d.index.get(rel)?.props ?? {};
    const first = fields.amount === undefined ? null : readMoney(fields.amount);
    if (kind === 'bill' && first !== null) {
      const from = readMoney(props.amount);
      // A row only when one amount really replaces another (2 Nov 2026): a first amount recorded — or the same
      // amount again — is not a price change, so the property is set with no row added.
      if (from === null) text = setNoteProp(text, 'amount', first);
      else if (from !== first) text = setNoteProp(withPrice(text, from, first, isoOf(this.today()), note), 'amount', first);
    } else if (first !== null && typeof fields.amount === 'number') text = setNoteProp(text, 'amount', first);
    for (const key of ['due', 'cycle', 'category', 'kind', 'period', 'institution', 'holder'] as const) {
      if (fields[key] === undefined || (kind === 'budget' && key !== 'period')) continue;
      if (kind === 'account' && !['institution', 'kind', 'holder'].includes(key)) continue;
      if (kind === 'bill' && !['due', 'cycle', 'category', 'kind'].includes(key)) continue;
      const v = String(fields[key] ?? '').trim();
      if (v) text = setNoteProp(text, key, v.slice(0, 80));
    }
    if (kind === 'bill' && typeof fields.account === 'string' && fields.account.trim()) text = setNoteProp(text, 'account', `[[${fields.account.trim().replace(/^\[\[|\]\]$/g, '')}]]`);
    if (kind === 'bill' && typeof fields.project === 'string' && fields.project.trim()) text = setNoteProp(text, 'project', `[[${fields.project.trim().replace(/^\[\[|\]\]$/g, '').slice(0, 120)}]]`);
    if (kind === 'bill' && fields.autopay !== undefined) text = setNoteProp(text, 'autopay', fields.autopay === true ? 'Yes' : 'No');
    if (kind === 'account' && fields.balance !== undefined) {
      const bal = readMoney(fields.balance);
      if (bal !== null) {
        text = setNoteProp(text, 'balance', bal);
        text = setNoteProp(text, 'as_of', isoOf(this.today()));
      }
    }
    // An update that moves nothing writes nothing (2 Nov 2026): no churn, no "Changed" card for a no-op.
    if (text === start) return false;
    await this.d.writeNote(rel, text);
    return true;
  }

  /** A row bill updated in place (an agent's add that names one already there, an emailed bill): only the
   *  fields given move. A changed amount is kept in its price history — which runs longer than the first
   *  line, so it becomes a note. True when something moved. */
  private async applyBillRowUpdate(rel: string, fields: Record<string, unknown>, note: string): Promise<boolean> {
    const w = this.billsWork();
    const hit = await billRowByPath(w, rel);
    if (!hit) throw new Error('That bill isn’t in the list any more.');
    if (hit.row.note) return this.applyUpdate('bill', hit.row.note, fields, note);
    const { doc } = await readBills(w);
    const row = findBillRow(doc, hit.row.name)!;
    const first = fields.amount === undefined ? null : readMoney(fields.amount);
    if (first !== null) {
      const from = readMoney(row.cells.amount || null);
      // A row only when one amount really replaces another: a first amount recorded — or the same amount
      // again — is not a price change. A real change makes it a note, with the history in it.
      if (from !== null && from !== first) {
        const made = await promoteToBillNote(w, row.name);
        return this.applyUpdate('bill', made, fields, note);
      }
    }
    const patch: Record<string, string> = {};
    if (first !== null && readMoney(row.cells.amount || null) === null) patch.amount = first.toFixed(2);
    for (const key of ['due', 'cycle', 'category', 'kind'] as const) {
      if (fields[key] === undefined) continue;
      const v = String(fields[key] ?? '').trim();
      if (v) patch[key] = v.slice(0, 80);
    }
    if (typeof fields.account === 'string' && fields.account.trim()) patch.account = `[[${fields.account.trim().replace(/^\[\[|\]\]$/g, '')}]]`;
    if (typeof fields.project === 'string' && fields.project.trim()) patch.project = `[[${fields.project.trim().replace(/^\[\[|\]\]$/g, '').slice(0, 120)}]]`;
    if (fields.autopay !== undefined) patch.autopay = fields.autopay === true ? 'Yes' : 'No';
    // An update that moves nothing writes nothing: no churn, no "Changed" card for a no-op.
    const moves = Object.entries(patch).filter(([k, v]) => (row.cells[k] ?? '') !== v);
    if (!moves.length) return false;
    await this.writeBillCells(row.name, Object.fromEntries(moves));
    return true;
  }

  /** A row bill's amount now (its note's once it became a note), else null. */
  private async billRowAmount(rel: string): Promise<number | null> {
    const hit = await billRowByPath(this.billsWork(), rel).catch(() => null);
    if (!hit) return null;
    if (hit.row.note) return readMoney(this.d.index.get(hit.row.note)?.props?.amount);
    return readMoney(hit.row.cells.amount || null);
  }

  /** An Inbox item filed as a bill: the bill updated (its price if it changed, its due day) or made, and a file kept with it. */
  async fileInboxBill(item: InboxItem): Promise<{ words: string; paths: string[] }> {
    const b = await this.inboxBillMatch(item);
    if (!b) throw new Error('That doesn’t read as a bill any more.');
    let rel = b.existing;
    const cur = currencyOf(await this.options());
    let words: string;
    if (rel) {
      const from = splitBillRow(rel) ? await this.billRowAmount(rel) : readMoney(this.d.index.get(rel)?.props?.amount);
      const moved = await this.applyUpdate('bill', rel, { amount: b.amount, ...(b.due ? { due: b.due } : {}) }, 'From a bill in the Inbox');
      // A real price change made it a note: the words name it, and a file below goes beside the note.
      if (splitBillRow(rel)) {
        const hit = await billRowByPath(this.billsWork(), rel).catch(() => null);
        if (hit?.row.note) rel = hit.row.note;
      }
      words = moved
        ? `Updated ${b.name}: ${moneyWords(b.amount, cur)}${b.due ? `, due ${dueWords(b.due, isoOf(this.today()))}` : ''}${from !== null && from !== b.amount ? ` (was ${moneyWords(from, cur)})` : ''}.`
        : `${b.name} is already up to date in Money: nothing was changed.`;
    } else {
      rel = await this.addBill({ name: b.name, amount: b.amount, due: b.due, cycle: 'Monthly' });
      words = `Added the bill ${b.name}: ${moneyWords(b.amount, cur)}${b.due ? `, due ${dueWords(b.due, isoOf(this.today()))}` : ''}.`;
    }
    const paths = [rel];
    if (item.kind === 'file' || item.kind === 'note') {
      if (splitBillRow(rel)) {
        // The bill's own file is the person's: the row becomes a note first, and it goes beside it.
        const hit = await billRowByPath(this.billsWork(), rel).catch(() => null);
        if (hit) rel = hit.row.note ?? (await promoteToBillNote(this.billsWork(), hit.row.name));
        paths[0] = rel;
      }
      // The bill's own file (the PDF emailed) moves from the Inbox to the bill, kept beside it (the app's own move).
      const dir = filesFolderFor(rel);
      const base = path.posix.basename(item.path);
      let dest = `${dir}/${base}`;
      for (let i = 2; (await this.d.vault().any(dest)) && i < 1000; i++) dest = `${dir}/${base.replace(/(\.[^.]+)?$/, ` ${i}$1`)}`;
      const moved = await this.d.movePath(item.path, dest);
      const text = this.noteText(rel);
      await this.d.writeNote(rel, /^##\s+Notes\s*$/im.test(text) ? text.replace(/^(##\s+Notes\s*)$/im, `$1\n\n- ![[${moved.path}|${path.posix.basename(moved.path)}]]`) : `${text.replace(/\s*$/, '')}\n\n- ![[${moved.path}|${path.posix.basename(moved.path)}]]\n`);
      paths.push(moved.path);
    }
    return { words, paths };
  }

  // ── Receipts that file themselves (10.0 v2money) ───────────────────────────────────────────────────────────────
  // A receipt photo or PDF dropped anywhere is read (its words from the PDF's text or the photo's recognised words)
  // and filed to Money: merchant, total and category, the file kept beside the month. Filed twice (the photo, then
  // the PDF) is filed once: the same day, amount and merchant words. Every filing carries Undo while the app is open.

  private receiptUndos = new Map<string, { month: string; date: string; amount: number; what: string; merchant: string; files: { at: string; backTo: string }[] }>();

  /** What a receipt's words would file as (its merchant, total, day and category, and the open bill it looks like,
   *  when one fits), or null when they read as no receipt. */
  async previewReceipt(words: string): Promise<{ merchant: string; total: number; date: string; category: string; duplicate: boolean; bill?: ReceiptBillMatch } | null> {
    if (!this.on().includes('finance')) return null;
    const found = receiptFromWords(words, this.today());
    if (!found) return null;
    const m = financeModel((await this.notesOf(this.d.index)).finance, this.today());
    const learned = learnedCategories(m.spending);
    const category = learned.get(merchantKey(found.merchant)) ?? guessCategory(found.merchant, learned);
    const key = spendDedupeKey(found.date, found.total, found.merchant);
    const bill = receiptBillMatch(found, m.bills, m.today) ?? undefined;
    return { ...found, category, duplicate: m.spending.some((s) => spendDedupeKey(s.date, s.amount, s.what) === key), ...(bill ? { bill } : {}) };
  }

  /** A free vault path beside a folder's file (an undone receipt back in the Inbox, never over one there). */
  private async freeVault(folder: string, base: string): Promise<string> {
    const v = this.d.vault();
    const dot = base.lastIndexOf('.');
    const stem = dot > 0 ? base.slice(0, dot) : base;
    const ext = dot > 0 ? base.slice(dot) : '';
    for (let n = 1; n < 500; n++) {
      const rel = `${folder}/${stem}${n > 1 ? ` ${n}` : ''}${ext}`;
      if (!(await v.any(rel))) return rel;
    }
    throw new Error('There is no free name for it there.');
  }

  /**
   * Receipt words filed to Money: its payment added to the month's spending with its category, the file (an Inbox
   * file moved beside the month, a file from the PC copied beside it) named in its row. Returns what to say, what
   * changed, the Undo id, and the open bill it looks like, when one fits. The bill is only ever named, never
   * marked paid here (10.0 v10money): the person marks it paid on the bill itself. Throws in plain words when the
   * words read as no receipt or the receipt is already filed.
   */
  async fileReceipt(words: string, file?: { path: string; inVault: boolean }): Promise<{ words: string; paths: string[]; undo: string; bill?: ReceiptBillMatch }> {
    this.need('finance');
    await this.d.requireCreate();
    const found = receiptFromWords(words, this.today());
    if (!found) throw new Error('That didn’t read as a receipt: no total could be found. When the photo is blurry or the PDF has no words, add it by hand in Money instead.');
    const m = financeModel((await this.notesOf(this.d.index)).finance, this.today());
    const learned = learnedCategories(m.spending);
    const category = learned.get(merchantKey(found.merchant)) ?? guessCategory(found.merchant, learned);
    const key = spendDedupeKey(found.date, found.total, found.merchant);
    if (m.spending.some((s) => spendDedupeKey(s.date, s.amount, s.what) === key)) throw new Error(`That receipt is already filed in Money: ${found.merchant}, ${moneyWords(found.total, currencyOf(await this.options()))} on ${found.date}.`);
    const bill = receiptBillMatch(found, m.bills, m.today) ?? undefined;
    const month = `${typeFolder('spending-month', await this.areas())}/${found.date.slice(0, 7)}.md`;
    const kept: string[] = [];
    const back: { at: string; backTo: string }[] = [];
    let receipt = '';
    if (file && file.inVault && file.path !== month) {
      const dir = filesFolderFor(month);
      const base = path.posix.basename(file.path);
      let dest = `${dir}/${base}`;
      for (let i = 2; (await this.d.vault().any(dest)) && i < 1000; i++) dest = `${dir}/${base.replace(/(\.[^.]+)?$/, ` ${i}$1`)}`;
      const moved = await this.d.movePath(file.path, dest);
      kept.push(moved.path);
      back.push({ at: moved.path, backTo: file.path });
      receipt = `[[${moved.path}|${path.posix.basename(moved.path)}]]`;
    } else if (file && !file.inVault && path.isAbsolute(file.path)) {
      const added = await this.d.importFiles([file.path], filesFolderFor(month));
      if (added[0]) {
        kept.push(added[0]);
        back.push({ at: added[0], backTo: '' });
        receipt = `[[${added[0]}|${path.posix.basename(added[0])}]]`;
      }
    }
    await this.addSpends([{ date: found.date, what: found.merchant, category, amount: found.total, receipt }]);
    const undo = randomBytes(9).toString('base64url');
    this.receiptUndos.set(undo, { month, date: found.date, amount: found.total, what: found.merchant, merchant: found.merchant, files: back });
    if (this.receiptUndos.size > 50) this.receiptUndos.delete(this.receiptUndos.keys().next().value!);
    const offer = bill ? ` This looks like the ${bill.name} bill (${bill.why}). Mark it paid in Money.` : '';
    return { words: `Filed the receipt in Money: ${found.merchant}, ${moneyWords(found.total, currencyOf(await this.options()))} on ${found.date} (${category}).${offer}`, paths: [month, ...kept], undo, ...(bill ? { bill } : {}) };
  }

  /** A filed receipt undone: its row taken out of the month (only its row), its file put back where it was (an Inbox
   *  file to the Inbox, a file from the PC to the Inbox for the person). Nothing is ever deleted for good. */
  async undoReceipt(id: string): Promise<string> {
    const u = typeof id === 'string' ? this.receiptUndos.get(id) : undefined;
    if (!u) throw new Error('That receipt can’t be undone any more (Undo lasts while the app is open). Its row can still be removed in Money.');
    const current = this.d.index.content(u.month);
    if (current !== undefined) {
      const next = withoutSpendRow(current, u.date, u.amount, u.what);
      if (next !== current) await this.d.writeNote(u.month, next);
    }
    for (const f of u.files) {
      try {
        const backTo = f.backTo || (await this.freeVault('Inbox', path.posix.basename(f.at)));
        const dest = f.backTo && (await this.d.vault().any(f.backTo)) ? await this.freeVault(path.posix.dirname(f.backTo) || 'Inbox', path.posix.basename(f.backTo)) : backTo;
        await this.d.movePath(f.at, dest);
      } catch {
        // The file moved on since: the row is still undone, and the file is still somewhere in the vault.
      }
    }
    this.receiptUndos.delete(id);
    return `Undid the filed receipt: ${u.merchant} is out of Money again, and its file is back in the Inbox.`;
  }

  /** An Inbox item's receipt reading (a photo or PDF's words, a line's words), or null when it reads as none. */
  async inboxReceipt(item: Pick<InboxItem, 'words' | 'kind' | 'path'>): Promise<{ merchant: string; total: number; date: string; category: string; duplicate: boolean; bill?: ReceiptBillMatch } | null> {
    if (!this.on().includes('finance')) return null;
    try {
      if (item.kind === 'file') {
        if (!isReceiptFile(item.path)) return null;
        const text = (await this.d.fileText?.(item.path).catch(() => null)) ?? '';
        if (!text.trim()) return null;
        return this.previewReceipt(text);
      }
      return this.previewReceipt(item.words);
    } catch {
      return null;
    }
  }

  /** An Inbox item filed as a receipt: its row in Money, its file kept beside the month, with Undo (and the open
   *  bill it looks like named in the words, when one fits). */
  async fileInboxReceipt(item: InboxItem): Promise<{ words: string; paths: string[]; undo: string; bill?: ReceiptBillMatch }> {
    let words = item.words;
    if (item.kind === 'file') {
      words = (await this.d.fileText?.(item.path).catch(() => null)) ?? '';
      if (!words.trim()) throw new Error('That file has no words to read yet. When it is a photo, it is read on Windows; when it is a PDF with no words, add it by hand in Money instead.');
    }
    const filed = await this.fileReceipt(words, item.kind === 'file' ? { path: item.path, inVault: true } : undefined);
    return filed;
  }

  // ── The agents' tools ────────────────────────────────────────────────────────────────────────────────────────────

  /** What an agent's tool answers from: the notes its gate lets through, and how many it wasn't allowed. */
  async toolInput(gated: VaultIndex, agent: string): Promise<ModuleToolInput> {
    const mine = await this.notesOf(gated);
    const all = gated === this.d.index ? mine : await this.notesOf(this.d.index);
    for (const n of mine.documents) n.files = await this.filesOf(n.path);
    const o = await this.options();
    return { ...mine, on: this.on(), refused: { finance: all.finance.length - mine.finance.length, documents: all.documents.length - mine.documents.length }, agent, currency: currencyOf(o), remindDays: { finance: remindDaysOf(o, 'finance'), documents: remindDaysOf(o, 'documents') }, income: incomeFromSettings(o.finance?.settings), today: this.today() };
  }

  /** A bank CSV file imported the way the Money window does (9.5, 2 Nov 2026: a bank file sent with a bot
   *  request is imported by the tool, never "open the Money window"). The same preview (planBankImport: rows with
   *  categories, bill links, duplicates, price changes) and the same apply path (importApply): duplicates skipped,
   *  bills paid, prices brought up to date. Possible new bills are named in the answer, never made. */
  async importCsvFile(file: unknown, account?: unknown): Promise<string> {
    this.need('finance');
    const given = typeof file === 'string' ? file.trim() : '';
    if (!given) throw new Error('Give the bank file’s path on this PC.');
    const abs = path.isAbsolute(given) ? given : path.join(this.d.vault().root, ...given.replace(/\\/g, '/').split('/'));
    // A bank statement only (reviewer, 2 Nov 2026): this reads a file anywhere on the PC, so never anything but a CSV or text export.
    if (!/\.(csv|txt)$/i.test(abs)) throw new Error('Give a bank statement exported as a CSV file (.csv).');
    let st;
    try {
      st = await fsp.stat(abs);
    } catch {
      throw new Error(`That file isn’t there any more: ${path.basename(given)}. Send it again.`);
    }
    if (!st.isFile() || st.size > MAX_CSV) throw new Error(st.size > MAX_CSV ? 'That file is larger than 20 MB. Export a shorter time span and import each one.' : `That file isn’t there any more: ${path.basename(given)}. Send it again.`);
    const text = await fsp.readFile(abs, 'utf8').catch(() => '');
    const plan = await this.importPlan(text);
    if (plan.problem) return plan.problem;
    const taken = plan.rows.filter((r) => !r.duplicate);
    const want = typeof account === 'string' ? account.trim().slice(0, 80) : '';
    let useAccount = '';
    let droppedAccount: string | null = null;
    if (want) {
      const accounts = (await this.finance()).accounts;
      try {
        useAccount = resolveOne(accounts, want, { noun: 'account', where: 'in Money' }).name;
      } catch {
        droppedAccount = want;
      }
    }
    const words = await this.importApply({ rows: taken.map((r) => ({ date: r.date, what: r.what, amount: r.amount, category: r.category })), account: useAccount, paid: plan.paid.filter((p) => taken.some((x) => x.bill === p.bill)), prices: plan.priceChanges.map((p) => ({ bill: p.bill, to: p.to, date: p.date })), bills: [] });
    const dupes = plan.rows.length - taken.length;
    const extra = [
      dupes ? `${dupes} already kept, left out` : '',
      plan.moneyIn ? `${plan.moneyIn} money in left out` : '',
      droppedAccount ? `the account “${droppedAccount}” isn’t in Money, so it was left empty` : '',
      plan.newBills.length ? `possible new bills: ${plan.newBills.map((b) => b.name).slice(0, 8).join(', ')} (add one with finance_bill_add)` : '',
    ].filter(Boolean);
    return extra.length ? `${words} ${extra.join('; ')}.` : words;
  }

  /** A row bill's list for the gate's check (a row has no note of its own to check). */
  private async tableOrPath(p: string): Promise<string> {
    return splitBillRow(p) ? billsTableRelFor(this.billsWork()) : p;
  }

  /** One of the tools, for an agent through its gated index; writes check the gate for the new note's folder. */
  async runTool(name: string, args: Record<string, unknown>, gated: VaultIndex, agent: string, check?: (rel: string) => void): Promise<string> {
    const tool = RECORD_MODULE_TOOLS.find((t) => t.name === name);
    if (!tool) throw new Error(`There is no tool called ${name}.`);
    if (!tool.write) return answerRecordModuleTool(await this.toolInput(gated, agent), name, args) ?? '';
    if (name === 'finance_csv_import') return this.importCsvFile(args.file, args.account);
    if (name === 'finance_bill_mark_paid') {
      const plan = planMarkPaid(args, await this.toolInput(gated, agent));
      check?.(await this.tableOrPath(plan.path));
      // The window's own Mark paid (its payment in the month's spending), from the account named when there is one.
      const words = await this.markPaid(plan.path, plan.day, true, plan.account || undefined, plan.amount);
      return `${words} [${plan.path}]`;
    }
    if (name === 'finance_receipt_add') {
      const plan = planReceiptAdd(args, await this.toolInput(gated, agent));
      const written = await this.addSpends([plan.row]);
      return `${plan.words} [${written[0] ?? ''}]`;
    }
    if (name === 'document_renewed') {
      const plan = planDocumentRenewed(args, await this.toolInput(gated, agent));
      check?.(plan.path);
      const made = await this.renewDocument(plan.path, plan.expires, plan.issued ?? undefined);
      return `${plan.words} [${made}]`;
    }
    const input = await this.toolInput(gated, agent);
    const plan = planRecordModuleWrite(name, args, { on: this.on(), areas: await this.areas(), today: this.today(), currency: currencyOf(await this.options()), notes: { finance: input.finance, documents: input.documents } });
    if (plan.update) {
      check?.(await this.tableOrPath(plan.update.path));
      await this.d.requireCreate();
      const kind = name === 'finance_account_add' ? 'account' : name === 'finance_budget_add' ? 'budget' : 'bill';
      const moved = await this.applyUpdate(kind, plan.update.path, plan.update.fields, 'Updated by an assistant');
      if (!moved) {
        const hit = splitBillRow(plan.update.path) ? await billRowByPath(this.billsWork(), plan.update.path).catch(() => null) : null;
        const title = hit ? hit.row.name : path.posix.basename(plan.update.path, '.md');
        return `${title} is already up to date in Money: nothing was changed. [${plan.update.path}]`;
      }
      return `${plan.words} [${plan.update.path}]`;
    }
    if (plan.billInput) {
      // New bills are rows in the one list, never notes.
      check?.(await billsTableRelFor(this.billsWork()));
      await this.d.requireCreate();
      const at = await this.addBill(plan.billInput);
      return `${plan.words} [${at}]`;
    }
    const rel = await this.freeNote(plan.folder, plan.name);
    check?.(rel);
    await this.d.requireCreate();
    await this.d.writeNote(rel, plan.text);
    return `${plan.words} [${rel}]`;
  }

  /** One of the tools for an agent with its gate (the side chat, an outside agent): null when it isn't one of these. Its
   *  reads come from what the gate lets through; a write is checked against the gate before anything is written. */
  async callTool(name: string, args: Record<string, unknown>, gate?: Gate | null): Promise<{ text: string } | null> {
    if (!RECORD_MODULE_TOOLS.some((t) => t.name === name)) return null;
    const gated = gate ? gateIndex(this.d.index, gate) : this.d.index;
    const tool = RECORD_MODULE_TOOLS.find((t) => t.name === name)!;
    // A new record has no note yet for the gate to check: the agent must be allowed its module's level.
    const level = MODULES.find((m) => m.id === tool.module)?.level;
    if (tool.write && gate && level && !gate.allowsLevel(level)) return { text: refusal(level, gate.name) };
    try {
      return { text: await this.runTool(name, args ?? {}, gated, gate?.name ?? 'This agent', gate ? (rel) => gate.check(rel, 'changed') : undefined) };
    } catch (e) {
      return { text: e instanceof Error ? e.message : String(e) };
    }
  }

  /** The side chat's line about these modules while one is on (src/main/modules.ts adds it to its own rules). */
  rules(): string {
    const on = this.on().filter((id) => id === 'finance' || id === 'documents');
    if (!on.length) return '';
    return [
      on.includes('finance') ? 'Money: use finance_bills_due, finance_bill_list and finance_spending for bills, subscriptions, spending and budgets; add a bill with finance_bill_add and mark one paid with finance_bill_mark_paid (the account it was paid from when they name one), only with the amount and day the person gave (never guess either). Add an account with finance_account_add and a budget with finance_budget_add; file a receipt read from a photo or PDF with finance_receipt_add; import a bank file sent with the request with finance_csv_import; look ahead and test whether a cost fits with finance_forecast. Account numbers and logins are never written in a note.' : '',
      on.includes('documents') ? 'Papers: use document_expiring and document_list; add one with document_add and save a renewal with document_renewed (a new copy is made, the old one kept). A document’s number is locked in Secrets: say so, never ask for it or write it anywhere.' : '',
    ]
      .filter(Boolean)
      .join(' ');
  }

  /** The tools offered now (only those of modules switched on). */
  toolsOn(): typeof RECORD_MODULE_TOOLS[number][] {
    const on = this.on();
    return RECORD_MODULE_TOOLS.filter((t) => on.includes(t.module));
  }

  // ── The Bills list and its one-time move ─────────────────────────────────────────────────────────────────────────

  billsMoveState(): Promise<BillsMoveState> {
    return billsMoveState(this.billsWork());
  }
  async billsMovePreview(): Promise<{ words: string[]; fold: { rel: string; name: string; why: string }[]; stay: { rel: string; name: string; why: string }[]; table: string; pcsBlock: { names: string[]; words: string } | null; clash: string | null }> {
    const w = this.billsWork();
    const plan = await planBillsMove(w, await w.billNotes());
    return { words: billsPreviewWords(plan), fold: plan.fold, stay: plan.stay, table: plan.table, pcsBlock: plan.pcsBlock, clash: plan.clash };
  }
  billsMoveRun(): Promise<string> {
    return runBillsMove(this.billsWork());
  }
  billsMoveResume(): Promise<string> {
    return resumeBillsMove(this.billsWork());
  }
  billsMoveUndo(): Promise<string> {
    return undoBillsMove(this.billsWork());
  }
  billsMoveDefer(): Promise<string> {
    return deferBillsMove(this.billsWork());
  }
  billsResolveRow(target: string): Promise<string | null> {
    return resolveBillRowTarget(this.billsWork(), String(target ?? '').slice(0, 200));
  }
  billsSearchRows(query: string): Promise<{ name: string; path: string; words: string }[]> {
    return searchBillsRows(this.billsWork(), String(query ?? '').slice(0, 200));
  }
  async billRowText(rel: string): Promise<string> {
    const hit = await billRowByPath(this.billsWork(), String(rel ?? '').slice(0, 1000));
    if (!hit) throw new Error('That bill isn’t in the list any more.');
    return billRowNoteText(this.billsWork(), hit.row.name);
  }
  async billsResolveConflict(name: string, keep: number): Promise<{ words: string; path: string }> {
    const at = await resolveBillsConflictAt(this.billsWork(), String(name ?? '').slice(0, 200), keep);
    return { words: `Kept your choice for ${String(name ?? '').slice(0, 200)}. The list holds one version now.`, path: at };
  }
}

export function registerRecordModules(m: RecordModules, d: Pick<RecordModulesDeps, 'vault' | 'index' | 'requireCreate'> & { handle(channel: string, fn: (...args: any[]) => unknown): void }): void {
  const { handle } = d;
  const str = (v: unknown, max = 400) => (typeof v === 'string' ? v.slice(0, max) : '');
  handle('recmod:finance', () => m.finance());
  handle('recmod:documents', () => m.documents());
  handle('recmod:options', async () => ({ options: await m.options(), on: m.on() }));
  handle('recmod:set-options', async (id: unknown, patch: unknown) => {
    await d.requireCreate();
    const next = withModuleOptions(await m.options(), str(id, 40), (patch && typeof patch === 'object' ? patch : {}) as ModuleOptions);
    const file = path.join(d.vault().root, ...MODULE_OPTIONS_FILE.split('/'));
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, writeModuleOptions(next), 'utf8');
    return next;
  });
  handle('recmod:set-field', (kind: unknown, rel: unknown, field: unknown, value: unknown, row: unknown) => m.setField(str(kind, 20), str(rel, 1000), str(field, 40), value, typeof row === 'number' ? row : undefined));
  handle('recmod:set-number', (rel: unknown, link: unknown) => m.setNumber(str(rel, 1000), str(link, 200)));
  handle('recmod:add-bill', (input: unknown) => m.addBill((input ?? {}) as BillInput));
  handle('recmod:add-account', (input: unknown) => m.addAccount((input ?? {}) as { name: string }));
  handle('recmod:add-budget', (category: unknown, amount: unknown, period: unknown) => m.addBudget(str(category, 60), amount, str(period, 20) || 'Monthly'));
  handle('recmod:add-spend', (row: unknown, files: unknown) => m.addSpendWithReceipt((row ?? {}) as SpendInput, Array.isArray(files) ? files.filter((f): f is string => typeof f === 'string') : []));
  handle('recmod:mark-paid', (rel: unknown, day: unknown, amount: unknown, account: unknown) => m.markPaid(str(rel, 1000), str(day, 20) || undefined, true, str(account, 80) || undefined, readMoney(amount) ?? undefined));
  handle('recmod:add-document', (input: unknown) => m.addDocument((input ?? {}) as DocumentInput));
  handle('recmod:renew-document', (rel: unknown, expires: unknown, issued: unknown) => m.renewDocument(str(rel, 1000), str(expires, 20), str(issued, 20) || undefined));
  handle('recmod:attach', (rel: unknown, files: unknown, row: unknown) => m.attach(str(rel, 1000), Array.isArray(files) ? files.filter((f): f is string => typeof f === 'string') : [], typeof row === 'number' ? row : undefined));
  handle('recmod:bill-note', (rel: unknown, words: unknown) => m.noteWords(str(rel, 1000), str(words, 2000)));
  handle('recmod:remove-bill', (rel: unknown) => m.removeBill(str(rel, 1000)));
  handle('recmod:bills-search', (query: unknown) => m.billsSearchRows(str(query, 200)));
  handle('recmod:bills-resolve', (target: unknown) => m.billsResolveRow(str(target, 200)));
  handle('recmod:bill-text', (rel: unknown) => m.billRowText(str(rel, 1000)));
  handle('recmod:bills-resolve-conflict', (name: unknown, keep: unknown) => m.billsResolveConflict(str(name, 200), typeof keep === 'number' ? keep : -1));
  handle('recmod:bills-move-state', () => m.billsMoveState());
  handle('recmod:bills-move-preview', () => m.billsMovePreview());
  handle('recmod:bills-move-run', () => m.billsMoveRun());
  handle('recmod:bills-move-resume', () => m.billsMoveResume());
  handle('recmod:bills-move-undo', () => m.billsMoveUndo());
  handle('recmod:bills-move-defer', () => m.billsMoveDefer());
  handle('recmod:csv-pick', () => m.pickCsv());
  handle('recmod:pick-files', (title: unknown) => m.pickFiles(str(title, 120)));
  handle('recmod:import-plan', (text: unknown) => m.importPlan(text));
  handle('recmod:import-apply', (choice: unknown) => m.importApply((choice ?? {}) as Parameters<RecordModules['importApply']>[0]));
  handle('recmod:receipt-preview', (words: unknown) => m.previewReceipt(str(words, 200000)));
  handle('recmod:receipt-file', (words: unknown, file: unknown) => m.fileReceipt(str(words, 200000), file && typeof file === 'object' ? { path: str((file as Record<string, unknown>).path, 1000), inVault: (file as Record<string, unknown>).inVault === true } : undefined));
  handle('recmod:undo-receipt', (id: unknown) => m.undoReceipt(str(id, 60)));
  handle('recmod:check', () => m.check());
  handle('recmod:offers', async (inbox: unknown) => {
    const items = d.index.allMeta().slice(0, 20000).map((n) => ({ title: n.title, type: typeof n.props?.type === 'string' ? n.props.type.toLowerCase() : undefined }));
    for (const w of Array.isArray(inbox) ? inbox.slice(0, 200) : []) if (typeof w === 'string') items.push({ title: '', words: w.slice(0, 400), inbox: true } as never);
    return moduleOffers(m.on(), await m.options(), items);
  });
}

export const recordModuleDeps = { MAX_CSV };
