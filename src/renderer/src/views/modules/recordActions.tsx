// What Finance and Documents and ID's pages do (Wave 5 part a): the forms for a bill, an account, a budget, a payment and
// a document; a bill marked paid; a file kept with a record; a number moved into Secrets; the module's own options; and a
// bank's CSV read, reviewed and added (BankImport).

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { ACCOUNT_KINDS, BILL_CATEGORIES, BILL_CYCLES, DOCUMENT_KINDS, SPEND_CATEGORIES } from '../../../../shared/module-records';
import { splitBillRow } from '../../../../shared/bills-table';
import { dueWords, moneyWords, type Bill, type ImportPlan } from '../../../../shared/finance';
import type { IdDocument } from '../../../../shared/id-documents';
import { documentName } from '../../../../shared/id-documents';
import type { FinanceView } from '../../../../shared/record-modules-api';
import { Icon } from '../../components/Icon';
import { showSecret } from '../../components/SecretLink';
import { useEscape } from '../../lib/useEscape';
import { did, numberToSecrets, secretsUnlocked } from '../../state/recordModules';
import { moduleChanged } from '../../state/modules';
import { showError, toast } from '../../state/store';
import * as A from '../../state/actions';
import { peek } from '../../state/peek';
import { openRecordForm, valueFiles, valueNumber, valueWords } from './RecordForm';
import { askInChat } from '../../state/chat';

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// ── Finance ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A bill opened: a row opens its bill page, a note peeks as it always did. */
export function openBill(path: string, name: string): void {
  if (splitBillRow(path)) A.openPath(path, { where: 'current' });
  else peek({ type: 'note', path }, { title: name, type: 'note' });
}

export function addBill(f: FinanceView | null, prefill: { name?: string; project?: string } = {}): void {
  const accounts = f?.accounts.map((a) => a.name) ?? [];
  openRecordForm({
    title: 'New bill or subscription',
    icon: 'receipt',
    line: prefill.project ? `When it comes round and what it costs. It belongs to ${prefill.project}, and its due day comes to Today and the bell before it’s due.` : 'When it comes round and what it costs. Its due day comes to Today and the bell before it’s due.',
    ok: 'Add it',
    fields: [
      { key: 'name', label: 'Who it’s to', kind: 'text', required: true, wide: true, placeholder: 'Harbour Internet', value: prefill.name ?? '' },
      { key: 'kind', label: 'It is a', kind: 'segment', options: ['Bill', 'Subscription'] },
      { key: 'amount', label: 'Amount', kind: 'money', hint: 'Each time it’s paid.' },
      { key: 'cycle', label: 'How often', kind: 'choice', options: [...BILL_CYCLES], value: 'Monthly' },
      { key: 'due', label: 'Next due', kind: 'date', hint: 'Any day it falls: the next ones follow from how often.' },
      { key: 'category', label: 'Category', kind: 'choice', options: [...BILL_CATEGORIES], value: 'Other' },
      { key: 'account', label: 'Paid from', kind: 'choice', options: ['', ...accounts], own: true, hint: accounts.length ? undefined : 'Add your accounts in Accounts to choose one here.' },
      { key: 'autopay', label: 'Paid automatically', kind: 'toggle', hint: 'Autopay bills move on by themselves; others wait to be marked paid.' },
    ],
    submit: async (v) => {
      const rel = await window.nv.recmod.addBill({ name: valueWords(v, 'name'), kind: v.kind === 'Subscription' ? 'Subscription' : 'Bill', amount: valueNumber(v, 'amount'), cycle: valueWords(v, 'cycle'), due: valueWords(v, 'due') || null, category: valueWords(v, 'category'), account: valueWords(v, 'account') || undefined, autopay: v.autopay === true, ...(prefill.project ? { project: prefill.project } : {}) });
      moduleChanged();
      toast(`Added ${valueWords(v, 'name')}.`, { label: 'Open', run: () => A.openPath(rel, { where: 'tab' }) });
    },
  });
}

export async function addAccount(): Promise<void> {
  const unlocked = await secretsUnlocked();
  openRecordForm({
    title: 'New account',
    icon: 'bank',
    line: 'The accounts your bills come out of. Its number goes in Secrets, never in the note.',
    ok: 'Add it',
    fields: [
      { key: 'name', label: 'Name', kind: 'text', required: true, wide: true, placeholder: 'Everyday account' },
      { key: 'institution', label: 'Bank or provider', kind: 'text', placeholder: 'Harbour Bank' },
      { key: 'kind', label: 'Type', kind: 'choice', options: [...ACCOUNT_KINDS] },
      { key: 'holder', label: 'Whose', kind: 'text' },
      { key: 'balance', label: 'Balance now', kind: 'money' },
      { key: 'number', label: 'Account or card number', kind: 'secret', wide: true, hint: unlocked ? 'Kept in Locked; the note holds only a locked link to it.' : 'Your secrets are locked: open Locked (More › Locked) to keep a number here. You can add it later from the account.' },
    ],
    submit: async (v) => {
      const name = valueWords(v, 'name');
      const number = valueWords(v, 'number') ? await numberToSecrets(`${name} number`, valueWords(v, 'number'), name, 'bank') : null;
      await window.nv.recmod.addAccount({ name, institution: valueWords(v, 'institution'), kind: valueWords(v, 'kind'), holder: valueWords(v, 'holder'), balance: valueNumber(v, 'balance'), ...(number ? { number } : {}) });
      moduleChanged();
      toast(`Added the account ${name}.`);
    },
  });
}

export function addBudget(f: FinanceView | null): void {
  const have = new Set(f?.budgets.map((b) => b.category.toLowerCase()) ?? []);
  const free = SPEND_CATEGORIES.filter((c) => !have.has(c.toLowerCase()));
  openRecordForm({
    title: 'New budget',
    icon: 'target',
    line: 'How much you mean to spend on one category. What you spend comes from your payments.',
    ok: 'Add it',
    fields: [
      { key: 'category', label: 'Category', kind: 'choice', options: [...free], own: true, required: true },
      { key: 'amount', label: 'Amount', kind: 'money', required: true },
      { key: 'period', label: 'Each', kind: 'segment', options: ['Monthly', 'Weekly', 'Yearly'] },
    ],
    submit: async (v) => {
      await window.nv.recmod.addBudget(valueWords(v, 'category'), valueNumber(v, 'amount'), valueWords(v, 'period'));
      moduleChanged();
      toast(`Budget for ${valueWords(v, 'category')} added.`);
    },
  });
}

export function addPayment(f: FinanceView | null): void {
  openRecordForm({
    title: 'New payment',
    icon: 'wallet',
    line: 'Something you spent, with its receipt if you have it.',
    ok: 'Add it',
    fields: [
      { key: 'what', label: 'What', kind: 'text', required: true, wide: true, placeholder: 'Groceries at the market' },
      { key: 'amount', label: 'Amount', kind: 'money', required: true },
      { key: 'date', label: 'Day', kind: 'date', value: todayIso(), required: true },
      { key: 'category', label: 'Category', kind: 'choice', options: [...SPEND_CATEGORIES], own: true, value: 'Groceries' },
      { key: 'account', label: 'Paid from', kind: 'choice', options: ['', ...(f?.accounts.map((a) => a.name) ?? [])], own: true },
      { key: 'receipt', label: 'Receipt', kind: 'files', wide: true, hint: 'A photo or PDF, kept with the month’s payments.' },
    ],
    submit: async (v) => {
      await window.nv.recmod.addSpend({ date: valueWords(v, 'date'), what: valueWords(v, 'what'), category: valueWords(v, 'category') || 'Other', amount: valueNumber(v, 'amount') ?? 0, account: valueWords(v, 'account') }, valueFiles(v, 'receipt'));
      moduleChanged();
      toast('Payment added.');
    },
  });
}

export function markPaid(b: Bill): void {
  void did(window.nv.recmod.markPaid(b.path));
}

/** A bill paid for something other than its amount, or from an account it doesn't name (9.5 fresh
 *  eyes F2, 2 Nov 2026): the payment's own amount and account, carried by the window's Mark paid
 *  like the chat's. The tick keeps paying the bill's amount in one tap. */
export function markPaidDifferent(b: Bill, accounts: string[], currency = 'AUD'): void {
  openRecordForm({
    title: `Mark ${b.name} paid`,
    icon: 'wallet',
    line: b.amount !== null ? `Its bill says ${moneyWords(b.amount, currency)}. Change it when the payment was different.` : 'Its bill has no amount, so give what was paid.',
    ok: 'Mark paid',
    fields: [
      { key: 'amount', label: 'Amount paid', kind: 'money', required: true, value: b.amount !== null ? String(b.amount) : '' },
      { key: 'account', label: 'Paid from', kind: 'choice', options: ['', ...accounts], own: true, value: b.account ?? '' },
    ],
    submit: async (v) => {
      await did(window.nv.recmod.markPaid(b.path, undefined, { amount: valueNumber(v, 'amount'), account: valueWords(v, 'account') || undefined }));
    },
  });
}

/** A bill row's own menu items: paying a different amount than the bill's. First, so the bill's
 *  own deed comes before open and delete. */
export function billPayMenu(b: Bill, accounts: string[], currency = 'AUD'): import('../../components/Menu').MenuItem[] {
  return [{ label: 'Mark paid with a different amount…', icon: 'wallet', run: () => markPaidDifferent(b, accounts, currency) }, { separator: true }];
}

/** Add from a file (26 Oct 2026: modules that are "just fields we are entering for things that should be smart"): the
 *  chosen statements, bills, scans or bookings are kept in the module's Files folder, ready to be read and linked from
 *  the module's records. */
export async function addFromFiles(module: string, folder: string, ask: string): Promise<void> {
  const files = await window.nv.recmod.pickFiles(`Choose the files to read into ${module}`).catch(() => [] as string[]);
  if (!files.length) return;
  let kept: string[] = [];
  try {
    kept = await window.nv.files.importPaths(files, `${folder}/Files`);
  } catch (err) {
    showError(err);
    return;
  }
  if (!kept.length) return;
  const named = kept.map((p) => `[[${p}]]`).join(', ');
  askInChat(`Read ${named} and ${ask} Check what ${module} already has first, so nothing is added twice, and tell me what you added and anything you weren't sure of.`);
}

/** A file kept with a record (its bill, its document), chosen from the PC. */
export async function keepFileWith(path: string, title: string): Promise<void> {
  const files = await window.nv.recmod.pickFiles(`Choose files to keep with ${title}`).catch(() => []);
  if (!files.length) return;
  await did(window.nv.recmod.attach(path, files), (r) => (r.length ? `Kept ${r.length === 1 ? r[0].split('/').pop() : `${r.length} files`} with ${title}.` : 'Nothing was added.'));
}

export function financeOptions(currency: string, remindDays: number, income: { name: string; amount: number; cycle: string; next: string | null }[] = []): void {
  const pay = income[0];
  openRecordForm({
    title: 'Money options',
    icon: 'settings',
    line: 'Kept with the vault, so every PC shows the same.',
    ok: 'Save',
    fields: [
      { key: 'currency', label: 'Currency', kind: 'choice', options: ['AUD', 'NZD', 'USD', 'GBP', 'EUR', 'CAD', 'SGD', 'JPY'], value: currency },
      { key: 'remind', label: 'Say a bill is due this many days before', kind: 'number', value: String(remindDays) },
      { key: 'income_name', label: 'Pay or money in, called', kind: 'text', placeholder: 'Pay', value: pay?.name ?? '', hint: 'For the next 90 days look-ahead. Leave the amount empty for none.' },
      { key: 'income_amount', label: 'Each time', kind: 'money', value: pay ? String(pay.amount) : '' },
      { key: 'income_cycle', label: 'How often it comes', kind: 'choice', options: ['Weekly', 'Fortnightly', 'Monthly', 'Quarterly', 'Half-yearly', 'Yearly', 'Once'], value: pay?.cycle ?? 'Monthly' },
      { key: 'income_next', label: 'Next expected on', kind: 'date', value: pay?.next ?? '' },
    ],
    submit: async (v) => {
      await window.nv.recmod.setOptions('finance', { currency: valueWords(v, 'currency'), remindDays: valueNumber(v, 'remind') ?? remindDays, settings: { income_name: valueWords(v, 'income_name'), income_amount: valueNumber(v, 'income_amount') ?? '', income_cycle: valueWords(v, 'income_cycle'), income_next: valueWords(v, 'income_next') } });
      moduleChanged();
      toast('Money options saved.');
    },
  });
}

/** A document renewed in one tap (30 Oct 2026, 8.3 wave 1): the new expiry, a new copy made, the old copy kept. */
export function renewDocument(d: IdDocument): void {
  openRecordForm({
    title: `Renewed: ${d.name}`,
    icon: 'idcard',
    line: 'A new copy is made with the new dates. The old copy is kept, with the renewal noted in it.',
    ok: 'Save the renewal',
    fields: [
      { key: 'expires', label: 'New one runs to', kind: 'date', required: true },
      { key: 'issued', label: 'Issued on', kind: 'date', value: todayIso() },
    ],
    submit: async (v) => {
      const rel = await window.nv.recmod.renewDocument(d.path, valueWords(v, 'expires'), valueWords(v, 'issued') || undefined);
      moduleChanged();
      toast(`Renewed ${d.name}. The old copy is kept.`, { label: 'Open the new copy', run: () => A.openPath(rel, { where: 'tab' }) });
    },
  });
}

// ── Documents and ID ─────────────────────────────────────────────────────────────────────────────────────────────────

export async function addDocument(prefill: { kind?: string } = {}): Promise<void> {
  const unlocked = await secretsUnlocked();
  openRecordForm({
    title: 'New document',
    icon: 'idcard',
    line: 'Its expiry comes to Today and the bell before it’s due. Its number is kept in Secrets.',
    ok: 'Add it',
    fields: [
      { key: 'kind', label: 'Kind', kind: 'choice', options: [...DOCUMENT_KINDS], own: true, value: prefill.kind ?? 'Passport' },
      { key: 'holder', label: 'Whose', kind: 'text', placeholder: 'Alex Example' },
      { key: 'issuer', label: 'Issued by', kind: 'text' },
      { key: 'version', label: 'Version', kind: 'text', placeholder: 'v3', show: (v) => v.kind === 'CV' },
      { key: 'issued', label: 'Issued on', kind: 'date' },
      { key: 'expires', label: 'Expires on', kind: 'date', show: (v) => v.kind !== 'CV' },
      { key: 'remind', label: 'Remind this many days before', kind: 'number', placeholder: 'Empty: passport 180, visa 90, licence 30', show: (v) => v.kind !== 'CV' },
      { key: 'number', label: 'Number', kind: 'secret', wide: true, hint: unlocked ? 'Kept in Locked and shown only while it is unlocked; never in the note, never to an agent.' : 'Your secrets are locked, so a number typed here can’t be kept yet: open Locked (More › Locked), or add it later from the document. It never goes in the note.', show: (v) => v.kind !== 'CV' },
      { key: 'files', label: 'Files', kind: 'files', wide: true, hint: 'A scan or photo, kept beside it.' },
    ],
    submit: async (v) => {
      const kind = valueWords(v, 'kind') || 'Other';
      const holder = valueWords(v, 'holder');
      const name = documentName({ kind, holder, version: valueWords(v, 'version') });
      const number = valueWords(v, 'number') ? await numberToSecrets(`${name} number`, valueWords(v, 'number'), name, 'id-number') : null;
      const rel = await window.nv.recmod.addDocument({ kind, holder, issuer: valueWords(v, 'issuer'), issued: valueWords(v, 'issued') || null, expires: valueWords(v, 'expires') || null, remind: valueNumber(v, 'remind'), version: valueWords(v, 'version'), ...(number ? { number } : {}) });
      if (valueFiles(v, 'files').length) await window.nv.recmod.attach(rel, valueFiles(v, 'files'));
      moduleChanged();
      toast(`Added ${name}.`, { label: 'Open', run: () => A.openPath(rel, { where: 'tab' }) });
    },
  });
}

/** A document's number: shown (Secrets unlocked) or added to Secrets. */
export function documentNumber(d: IdDocument): void {
  if (d.secret) return void showSecret(d.secret);
  openRecordForm({
    title: `Number for ${d.name}`,
    icon: 'key',
    line: d.plainNumber ? 'It is written in the note now. Type it here to keep it in Secrets instead, then take it out of the note.' : 'Kept in your locked Secrets; the document holds only a locked link to it.',
    ok: 'Keep it in Secrets',
    fields: [{ key: 'number', label: 'Number', kind: 'secret', required: true, wide: true }],
    submit: async (v) => {
      const link = await numberToSecrets(`${d.name} number`, valueWords(v, 'number'), d.name, 'id-number');
      if (!link) throw new Error('Your secrets are locked. Open Locked (More › Locked), then add the number.');
      await window.nv.recmod.setNumber(d.path, link);
      moduleChanged();
      toast('The number is kept in Secrets.');
    },
  });
}

export function documentOptions(remindDays: number): void {
  openRecordForm({
    title: 'Papers options',
    icon: 'settings',
    ok: 'Save',
    fields: [{ key: 'remind', label: 'Remind this many days before a document expires', kind: 'number', value: String(remindDays), hint: 'A document can have its own number of days.' }],
    submit: async (v) => {
      await window.nv.recmod.setOptions('documents', { remindDays: valueNumber(v, 'remind') ?? remindDays });
      moduleChanged();
      toast('Options saved.');
    },
  });
}

// ── A bank's CSV ─────────────────────────────────────────────────────────────────────────────────────────────────────

type Review = { name: string; plan: ImportPlan; finance: FinanceView } | null;
let review: Review = null;
const reviewListeners = new Set<() => void>();
const setReview = (r: Review) => {
  review = r;
  reviewListeners.forEach((fn) => fn());
};

/** The person picks their bank's CSV; it is read and shown for them to check before anything is added. */
export async function importBankCsv(finance: FinanceView | null): Promise<void> {
  try {
    const file = await window.nv.recmod.pickCsv();
    if (!file) return;
    const plan = await window.nv.recmod.importPlan(file.text);
    const f = finance ?? (await window.nv.recmod.finance());
    setReview({ name: file.name, plan, finance: f });
  } catch (err) {
    showError(err);
  }
}

export function BankImportHost() {
  const r = useSyncExternalStore(
    (fn) => {
      reviewListeners.add(fn);
      return () => reviewListeners.delete(fn);
    },
    () => review,
  );
  if (!r) return null;
  return createPortal(<BankImport key={r.name} r={r} />, document.body);
}

function BankImport({ r }: { r: NonNullable<Review> }) {
  const { plan, finance } = r;
  const cur = finance.currency;
  const [cats, setCats] = useState<string[]>(() => plan.rows.map((x) => x.category));
  const [skip, setSkip] = useState<Set<number>>(() => new Set(plan.rows.flatMap((x, i) => (x.duplicate ? [i] : []))));
  const [prices, setPrices] = useState<Set<string>>(() => new Set(plan.priceChanges.map((p) => p.bill)));
  const [bills, setBills] = useState<Set<number>>(() => new Set());
  const [names, setNames] = useState<string[]>(() => plan.newBills.map((b) => b.name));
  // Which account the file is from: the person says (a bank's export is one account; never guessed).
  const [account, setAccount] = useState(finance.accounts.length === 1 ? finance.accounts[0].name : '');
  const [busy, setBusy] = useState(false);
  const [limit, setLimit] = useState(60);
  useEscape(() => !busy && setReview(null));
  useEffect(() => setLimit(60), [r]);
  const taken = plan.rows.filter((_, i) => !skip.has(i));
  const total = taken.reduce((s, x) => s + x.amount, 0);
  const first = plan.rows[0]?.date;
  const last = plan.rows[plan.rows.length - 1]?.date;
  const dupes = plan.rows.filter((x) => x.duplicate).length;
  const billName = useMemo(() => new Map(finance.bills.map((b) => [b.path, b.name])), [finance.bills]);
  const apply = async () => {
    setBusy(true);
    try {
      const words = await window.nv.recmod.importApply({
        rows: plan.rows.flatMap((x, i) => (skip.has(i) ? [] : [{ date: x.date, what: x.what, amount: x.amount, category: cats[i] || 'Other' }])),
        account,
        paid: plan.paid.filter((p) => plan.rows.some((x, i) => !skip.has(i) && x.bill === p.bill)),
        prices: plan.priceChanges.filter((p) => prices.has(p.bill)).map((p) => ({ bill: p.bill, to: p.to, date: p.date })),
        bills: plan.newBills.flatMap((b, i) => (bills.has(i) ? [{ name: names[i] || b.name, amount: b.amount, cycle: b.cycle, due: b.next, category: b.category, account: account || undefined }] : [])),
      });
      setReview(null);
      moduleChanged();
      toast(words);
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="overlay rf-overlay" onMouseDown={() => !busy && setReview(null)}>
      <div className="dialog rf-dialog bi-dialog" role="dialog" aria-modal="true" aria-labelledby="bi-title" onMouseDown={(e) => e.stopPropagation()}>
        <header className="rf-head">
          <span className="rf-mark" aria-hidden="true">
            <Icon name="upload" size={18} />
          </span>
          <div>
            <h2 id="bi-title">Import {r.name}</h2>
            {plan.problem ? (
              <p className="rf-line">{plan.problem}</p>
            ) : (
              <p className="rf-line">
                {plan.rows.length} {plan.rows.length === 1 ? 'payment' : 'payments'}
                {first && last ? ` from ${dueWords(first, todayIso())} to ${dueWords(last, todayIso())}` : ''}, read from {plan.read}.{plan.remembered ? ' Columns remembered for this bank.' : ' Its columns are remembered for next time.'}{plan.moneyIn ? ` ${plan.moneyIn} money in (pay and the like) left out.` : ''}
                {dupes ? ` ${dupes} already kept, left out.` : ''}
              </p>
            )}
          </div>
        </header>
        {!plan.problem && (
          <div className="bi-body">
            <div className="bi-bar">
              <label className="bi-account">
                <span>From the account</span>
                <select value={account} onChange={(e) => setAccount(e.target.value)}>
                  <option value="">Not said</option>
                  {finance.accounts.map((a) => (
                    <option key={a.path} value={a.name}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
              <span className="bi-total">
                {taken.length} to add · <strong>{moneyWords(Math.round(total * 100) / 100, cur)}</strong>
              </span>
            </div>
            {(plan.priceChanges.length > 0 || plan.newBills.length > 0 || plan.paid.length > 0) && (
              <div className="bi-found">
                {plan.paid.length > 0 && (
                  <p className="bi-found-line">
                    <Icon name="check" size={13} /> Pays {plan.paid.length} of your bills: {plan.paid.map((p) => billName.get(p.bill) ?? p.bill).join(', ')}. They’re marked paid.
                  </p>
                )}
                {plan.priceChanges.map((p) => (
                  <label key={p.bill} className="bi-choice">
                    <input type="checkbox" checked={prices.has(p.bill)} onChange={(e) => setPrices((s) => { const n = new Set(s); if (e.target.checked) n.add(p.bill); else n.delete(p.bill); return n; })} />
                    <span>
                      <strong>{p.name}</strong> went {p.to > p.from ? 'up' : 'down'}: {moneyWords(p.from, cur)} → {moneyWords(p.to, cur)}. Update the bill (its price history keeps both).
                    </span>
                  </label>
                ))}
                {plan.newBills.map((b, i) => (
                  <label key={i} className="bi-choice">
                    <input type="checkbox" checked={bills.has(i)} onChange={(e) => setBills((s) => { const n = new Set(s); if (e.target.checked) n.add(i); else n.delete(i); return n; })} />
                    <span className="bi-new-bill">
                      Looks like a bill: <input className="bi-name" value={names[i]} aria-label="Its name" onChange={(e) => setNames((x) => x.map((y, j) => (j === i ? e.target.value : y)))} /> {moneyWords(b.amount, cur)}, {b.why.toLowerCase()}. Add it as a bill.
                    </span>
                  </label>
                ))}
              </div>
            )}
            <div className="bi-table-wrap">
              <table className="bi-table">
                <thead>
                  <tr>
                    <th className="bi-tick" aria-label="Add" />
                    <th>Day</th>
                    <th>What</th>
                    <th>Category</th>
                    <th className="bi-amount">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.rows.slice(0, limit).map((x, i) => (
                    <tr key={i} className={skip.has(i) ? 'is-skipped' : ''}>
                      <td className="bi-tick">
                        <input type="checkbox" aria-label={`Add ${x.what}`} checked={!skip.has(i)} onChange={(e) => setSkip((s) => { const n = new Set(s); if (e.target.checked) n.delete(i); else n.add(i); return n; })} />
                      </td>
                      <td className="bi-day">{dueWords(x.date, todayIso())}</td>
                      <td className="bi-what" title={x.what}>
                        {x.what}
                        {x.duplicate && <span className="bi-note">already kept</span>}
                        {x.bill && <span className="bi-note is-bill">{billName.get(x.bill)}</span>}
                      </td>
                      <td>
                        <select className="bi-cat" value={cats[i]} aria-label="Category" onChange={(e) => setCats((c) => c.map((y, j) => (j === i ? e.target.value : y)))}>
                          {[...new Set([cats[i], ...SPEND_CATEGORIES])].map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="bi-amount">{moneyWords(x.amount, cur)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {plan.rows.length > limit && (
                <button type="button" className="text-button bi-more" onClick={() => setLimit((n) => n + 200)}>
                  Show {Math.min(200, plan.rows.length - limit)} more of {plan.rows.length - limit}
                </button>
              )}
            </div>
          </div>
        )}
        <div className="dialog-actions rf-actions">
          <button type="button" className="button" disabled={busy} onClick={() => setReview(null)}>
            {plan.problem ? 'Close' : 'Cancel'}
          </button>
          {!plan.problem && (
            <button type="button" className="button primary" disabled={busy || (!taken.length && !prices.size && !bills.size)} onClick={() => void apply()}>
              {busy ? 'Adding…' : `Add ${taken.length} ${taken.length === 1 ? 'payment' : 'payments'}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
