// Finance and Documents and ID as records the vault's views lay out (Wave 5, 24 Oct 2026). The modules have no screens of
// their own: each page of a module is a view of records (src/shared/record-views.ts: table, board, list, gallery,
// timeline, calendar, chart), the same views a project's workspace uses, so a bill or a document is opened, edited where
// it shows, grouped, filtered, charted and saved like any other record.
//
// Pure: no files, no Node, no DOM. The window draws (views/modules/RecordModulePage.tsx); the tests run it directly.

import { occurrence, type FinanceModel } from './finance';
import type { DocumentsModel } from './id-documents';
import { defaultRecordView, type RecordViewDef } from './record-views';
import type { WsRecord } from './workspace-records';

/** Every Finance record, as the views take them. */
export function financeRecords(m: FinanceModel): WsRecord[] {
  const out: WsRecord[] = [];
  for (const b of m.bills)
    out.push({
      id: `${b.path}::bill`,
      kind: 'bill',
      title: b.name,
      path: b.path,
      fields: {
        bill_type: b.kind,
        amount: b.amount,
        cycle: b.cycle,
        due: b.next,
        category: b.category,
        account: b.account,
        project: b.project,
        autopay: b.autopay,
        status: b.overdue ? 'Overdue' : b.status,
        monthly: b.monthly,
        paid: b.paid,
        change: b.change ? `${b.change.from.toFixed(2)} → ${b.change.to.toFixed(2)}` : null,
      },
      links: [],
    });
  for (const a of m.accounts)
    out.push({
      id: `${a.path}::account`,
      kind: 'account',
      title: a.name,
      path: a.path,
      fields: { institution: a.institution || null, account_type: a.type, holder: a.holder || null, balance: a.balance, as_of: a.asOf, number: a.number ? (/secret:/.test(a.number) ? 'Locked in Secrets' : 'Written in the note') : null },
      links: [],
    });
  for (const b of m.budgets)
    out.push({
      id: `${b.path}::budget`,
      kind: 'budget',
      title: b.category,
      path: b.path,
      fields: { category: b.category, budget: b.monthly, spent: b.spent, left: b.left, progress: b.progress, period: b.period },
      links: [],
    });
  for (const s of m.spending)
    out.push({
      id: s.id,
      kind: 'spend',
      title: s.what || 'Payment',
      path: s.path,
      fields: { date: s.date, month: s.date.slice(0, 7), category: s.category, amount: s.amount, account: s.account || null, receipt: s.receipt || null },
      links: [],
      ref: { at: 'table', heading: 'Spending', row: s.row, cols: { date: 0, title: 1, category: 2, amount: 3, account: 4, receipt: 5 } },
    });
  return out;
}

/** Each bill on every day it falls from a month back to a year ahead (the due-date calendar shows a monthly bill in every
 *  month, not only its next day). Each is the bill itself: opening one opens the bill. */
export function billDays(m: FinanceModel): WsRecord[] {
  const from = shift(m.today, -31);
  const to = shift(m.today, 366);
  const out: WsRecord[] = [];
  for (const b of m.bills) {
    if (!b.next || !b.anchor) continue;
    const days = new Set<string>([b.next]);
    if (b.cycle !== 'Once') for (let k = -60; k <= 60; k++) {
      const d = occurrence(b.anchor, b.cycle, k);
      if (d >= from && d <= to && (d >= b.next || d >= m.today)) days.add(d);
    }
    for (const d of days)
      out.push({ id: `${b.path}::bill@${d}`, kind: 'bill', title: b.name, path: b.path, fields: { amount: b.amount, cycle: b.cycle, due: d, category: b.category, autopay: b.autopay, status: d === b.next && b.overdue ? 'Overdue' : b.status }, links: [] });
  }
  return out;
}
function shift(iso: string, n: number): string {
  const d = new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)) + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Every document, as the views take them (never its number: only whether it is locked away). */
export function documentRecords(m: DocumentsModel): WsRecord[] {
  return m.documents.map((d) => ({
    id: `${d.path}::document`,
    kind: 'document',
    title: d.name,
    path: d.path,
    fields: { doc_type: d.kind, holder: d.holder || null, issuer: d.issuer || null, issued: d.issued, expires: d.status === 'Renewed' ? null : d.expires, status: d.status, version: d.version || null, number: d.secret ? 'Locked in Secrets' : d.plainNumber ? 'Written in the note' : null, files: d.files.length || null },
    links: [],
  }));
}

/** The fields of each kind that can be changed where they show (each one property of its note, or a payment's cell). */
export const EDITABLE: Record<string, string[]> = {
  bill: ['title', 'amount', 'cycle', 'due', 'category', 'account', 'project', 'autopay', 'bill_type'],
  account: ['institution', 'account_type', 'holder', 'balance', 'as_of'],
  budget: ['budget'],
  spend: ['title', 'date', 'category', 'amount', 'account'],
  document: ['doc_type', 'holder', 'issuer', 'issued', 'expires', 'version'],
};

/** A record's field → the note property it is written as (a payment's fields are its table's cells). */
export const PROPERTY_OF: Record<string, Record<string, string>> = {
  bill: { amount: 'amount', cycle: 'cycle', due: 'due', category: 'category', account: 'account', project: 'project', autopay: 'autopay', bill_type: 'kind' },
  account: { institution: 'institution', account_type: 'kind', holder: 'holder', balance: 'balance', as_of: 'as_of' },
  budget: { budget: 'amount' },
  document: { doc_type: 'kind', holder: 'holder', issuer: 'issuer', issued: 'issued', expires: 'expires', version: 'version' },
};

/** Each page's view as it is first made (the person's changes to it are kept in the vault, src/main/record-modules.ts). */
export function sectionViews(module: string, section: string, today: string): RecordViewDef[] {
  const v = (kinds: WsRecord['kind'][], layout: RecordViewDef['layout'], title: string, patch: Partial<RecordViewDef> = {}): RecordViewDef => ({ ...defaultRecordView(kinds, layout, title), scope: 'vault', ...patch });
  const monthStart = `${today.slice(0, 7)}-01`;
  if (module === 'finance') {
    switch (section) {
      case 'bills':
        return [v(['bill'], 'table', 'Bills and subscriptions', { fields: ['amount', 'cycle', 'due', 'category', 'autopay', 'account', 'project', 'monthly'], sort: { field: 'due', dir: 'asc' }, showDone: true })];
      case 'calendar':
        return [v(['bill'], 'calendar', 'Due dates', { dateField: 'due', fields: ['amount'], showDone: true })];
      case 'spending':
        return [
          v(['spend'], 'chart', 'Spent each month', { chart: { type: 'bar', by: 'month', measure: 'amount', agg: 'sum' }, showDone: true }),
          v(['spend'], 'chart', 'This month by category', { chart: { type: 'donut', by: 'category', measure: 'amount', agg: 'sum' }, filters: [{ field: 'date', op: 'after', value: isoBefore(monthStart) }], showDone: true }),
          v(['spend'], 'table', 'Payments', { fields: ['date', 'category', 'amount', 'account', 'receipt'], sort: { field: 'date', dir: 'desc' }, showDone: true }),
        ];
      case 'budgets':
        return [
          v(['budget'], 'chart', 'Budget beside what’s spent this month', { chart: { type: 'bar', by: 'category', measure: 'spent', agg: 'sum', target: 'budget' }, showDone: true }),
          v(['budget'], 'table', 'Budgets', { fields: ['budget', 'spent', 'left', 'progress'], sort: { field: 'title', dir: 'asc' }, showDone: true }),
        ];
      case 'accounts':
        return [v(['account'], 'table', 'Accounts', { fields: ['institution', 'account_type', 'holder', 'balance', 'as_of', 'number'], showDone: true })];
      case 'receipts':
        return [v(['spend'], 'table', 'Receipts', { fields: ['date', 'amount', 'category', 'receipt'], filters: [{ field: 'receipt', op: 'not-empty' }], sort: { field: 'date', dir: 'desc' }, showDone: true })];
    }
  }
  if (module === 'documents') {
    switch (section) {
      case 'all':
        return [v(['document'], 'table', 'All documents', { fields: ['holder', 'issuer', 'expires', 'status', 'number'], groupBy: 'doc_type', sort: { field: 'expires', dir: 'asc' }, showDone: true })];
      case 'expiry':
        return [v(['document'], 'timeline', 'When each expires', { dateField: 'expires', fields: ['holder'], showDone: true })];
      case 'cv':
        return [v(['document'], 'table', 'CV versions', { fields: ['version', 'issued', 'files'], filters: [{ field: 'doc_type', op: 'is', value: 'CV' }], sort: { field: 'version', dir: 'desc' }, showDone: true })];
    }
  }
  return [];
}

function isoBefore(iso: string): string {
  const d = new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)) - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
