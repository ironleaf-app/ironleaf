// The window's way to Finance and Documents and ID (Wave 5 part a; src/main/record-modules.ts). Built by the preload
// bridge with its own invoke, so every channel is Ironleaf's (nv:…).

import type { BillInput, FinanceForecast, FinanceModel, ImportPlan, IncomeEntry, SpendInput } from './finance';
import type { DocumentInput, DocumentsModel } from './id-documents';
import type { ModuleOffer, ModuleOptions, ModuleOptionsFile } from './module-records';

export interface BillsMoveView {
  offer: boolean;
  deferred: boolean;
  done: { at: string; folded: number; backup: string } | null;
  interrupted: boolean;
  undoable: boolean;
  pcsBlock: { names: string[]; words: string } | null;
  counts: { fold: number; stay: number };
  missingLists: string[];
  missingWords: string[];
  backupExists: boolean;
}
export interface BillsMovePreview { words: string[]; fold: { rel: string; name: string; why: string }[]; stay: { rel: string; name: string; why: string }[]; table: string; pcsBlock: { names: string[]; words: string } | null; clash: string | null }
/** A bill changed on both PCs: the shown version and each other one to choose, as the Systems lists carry. */
export interface BillsConflict { name: string; path: string; kept: Record<string, string>; keptNote: string | null; others: { name: string; cells: Record<string, string>; note: string | null }[] }

export type FinanceView = FinanceModel & { currency: string; remindDays: number; folder: string; forecast: FinanceForecast; income: IncomeEntry[]; billsMove: BillsMoveView; billsConflicts: BillsConflict[] };
export type DocumentsView = DocumentsModel & { remindDays: number; folder: string };

export function recordModulesApi(invoke: <T>(channel: string, ...args: unknown[]) => Promise<T>) {
  return {
    finance: () => invoke<FinanceView>('recmod:finance'),
    documents: () => invoke<DocumentsView>('recmod:documents'),
    options: () => invoke<{ options: ModuleOptionsFile; on: string[] }>('recmod:options'),
    setOptions: (id: string, patch: ModuleOptions) => invoke<ModuleOptionsFile>('recmod:set-options', id, patch),
    setField: (kind: string, rel: string, field: string, value: unknown, row?: number) => invoke<string | null>('recmod:set-field', kind, rel, field, value, row),
    setNumber: (rel: string, link: string) => invoke<void>('recmod:set-number', rel, link),
    addBill: (input: BillInput) => invoke<string>('recmod:add-bill', input),
    addAccount: (input: { name: string; institution?: string; kind?: string; holder?: string; number?: string; balance?: number | null }) => invoke<string>('recmod:add-account', input),
    addBudget: (category: string, amount: number | null, period?: string) => invoke<string>('recmod:add-budget', category, amount, period),
    addSpend: (row: SpendInput, files: string[] = []) => invoke<string[]>('recmod:add-spend', row, files),
    markPaid: (rel: string, day?: string, extra?: { amount?: number | null; account?: string }) => invoke<string>('recmod:mark-paid', rel, day, extra?.amount ?? null, extra?.account ?? ''),
    addDocument: (input: DocumentInput & { name?: string }) => invoke<string>('recmod:add-document', input),
    renewDocument: (rel: string, expires: string, issued?: string) => invoke<string>('recmod:renew-document', rel, expires, issued ?? ''),
    attach: (rel: string, files: string[], row?: number) => invoke<string[]>('recmod:attach', rel, files, row),
    pickFiles: (title?: string) => invoke<string[]>('recmod:pick-files', title ?? ''),
    pickCsv: () => invoke<{ name: string; text: string } | null>('recmod:csv-pick'),
    importPlan: (text: string) => invoke<ImportPlan>('recmod:import-plan', text),
    importApply: (choice: { rows: { date: string; what: string; amount: number; category: string }[]; account?: string; paid?: { bill: string; date: string }[]; prices?: { bill: string; to: number; date: string }[]; bills?: BillInput[] }) => invoke<string>('recmod:import-apply', choice),
    check: () => invoke<number>('recmod:check'),
    offers: (inbox: string[] = []) => invoke<ModuleOffer[]>('recmod:offers', inbox),
    receiptPreview: (words: string) => invoke<{ merchant: string; total: number; date: string; category: string; duplicate: boolean; bill?: { path: string; name: string; why: string } } | null>('recmod:receipt-preview', words),
    receiptFile: (words: string, file?: { path: string; inVault: boolean }) => invoke<{ words: string; paths: string[]; undo: string; bill?: { path: string; name: string; why: string } }>('recmod:receipt-file', words, file ?? null),
    undoReceipt: (id: string) => invoke<string>('recmod:undo-receipt', id),
    billNote: (rel: string, words: string) => invoke<string>('recmod:bill-note', rel, words),
    removeBill: (rel: string) => invoke<string>('recmod:remove-bill', rel),
    billsSearch: (query: string) => invoke<{ name: string; path: string; words: string }[]>('recmod:bills-search', query),
    billsResolve: (target: string) => invoke<string | null>('recmod:bills-resolve', target),
    billText: (rel: string) => invoke<string>('recmod:bill-text', rel),
    billsResolveConflict: (name: string, keep: number) => invoke<{ words: string; path: string }>('recmod:bills-resolve-conflict', name, keep),
    billsMoveState: () => invoke<BillsMoveView>('recmod:bills-move-state'),
    billsMovePreview: () => invoke<BillsMovePreview>('recmod:bills-move-preview'),
    billsMoveRun: () => invoke<string>('recmod:bills-move-run'),
    billsMoveResume: () => invoke<string>('recmod:bills-move-resume'),
    billsMoveUndo: () => invoke<string>('recmod:bills-move-undo'),
    billsMoveDefer: () => invoke<string>('recmod:bills-move-defer'),
  };
}

export type RecordModulesApi = ReturnType<typeof recordModulesApi>;
