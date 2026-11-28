// Finance's and Documents and ID's pages (8.7 wave 3a, the Vault redesign, work half): each pack a normal page in
// the one page shape (the tile with the title, one plain line, key facts, labelled cards), wired to the pack's real
// data and actions. Finance: what is due with its bills and budgets, the Bills page (due now and subscriptions, ticked
// where they show), the Next-90-days look-ahead (balance by week, whether a cost fits), and the pack's other pages
// (spending, budgets, accounts, due dates, receipts, every bill as a table) reached from the one menu. Documents and
// ID: what expires soon, every document by kind, and each document's own page (its files, what links to it, its number
// kept locked). Nothing the person could do is lost: add, edit where it shows or in its note, delete to the Recycle
// Bin, find it in search.

import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { MODULES, type RecordModule } from '../../../../shared/module-records';
import { cleanRecordView, fieldsOf, type FieldInfo, type RecordViewDef } from '../../../../shared/record-views';
import { billDays, documentRecords, EDITABLE, financeRecords, sectionViews } from '../../../../shared/record-modules';
import { affordCheck, biggestOut, billsMonthlyTotal, dueWords, forecastHeadline, forecastWeekRange, linkName, moneyWords, type Bill } from '../../../../shared/finance';
import { attentionOrder } from '../../../../shared/module-purpose';
import { plural } from '../../../../shared/words';
import { expiryWords, type IdDocument } from '../../../../shared/id-documents';
import type { BillsConflict, BillsMovePreview, DocumentsView, FinanceView } from '../../../../shared/record-modules-api';
import type { WsRecord } from '../../../../shared/workspace-records';
import { partOn } from '../../../../shared/life-modules';
import { EmptyState } from '../../components/EmptyState';
import { Icon } from '../../components/Icon';
import * as A from '../../state/actions';
import { openTour } from '../../state/moduleFills';
import { moduleChanged, openModule, partOfTab, useModules } from '../../state/modules';
import { peek } from '../../state/peek';
import { useDocuments, useFinance, useModuleOptions } from '../../state/recordModules';
import { getState, showError, toast, useApp } from '../../state/store';
import type * as W from '../../state/workspace';
import { RecordView } from '../workspace/RecordView';
import { RecordContext, type RecordCtx } from '../workspace/recordParts';
import { EditorContext, Inline, InlineDate } from '../project/Inline';
import { addAccount, addBill, addBudget, addDocument, addFromFiles, addPayment, BankImportHost, billPayMenu, documentNumber, documentOptions, financeOptions, importBankCsv, keepFileWith, markPaid, openBill, renewDocument } from './recordActions';
import { RecordFormHost } from './RecordForm';
import { AskFloat, PackSection, PackShell, Tick, longDay, packName, rowContext, rowMenu, type Tint } from './pack87';
import { billRowTag, payableByHand } from './billRow';
import { billNameKey, splitBillRow } from '../../../../shared/bills-table';
import type { MenuItem } from '../../components/Menu';

const FINANCE = MODULES.find((m) => m.id === 'finance')!;
const DOCUMENTS = MODULES.find((m) => m.id === 'documents')!;

/** The pages a Finance part shows (its switch in Settings › Packs). The look-ahead reads the bills. */
const FINANCE_PART: Record<string, string> = { bills: 'bills', 'bills-table': 'bills', calendar: 'bills', lookahead: 'bills', spending: 'spending', budgets: 'spending', receipts: 'spending', accounts: 'accounts' };

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const FULL_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** "Sun" for a day due within the week; "3 Nov" past it. */
const shortDay = (iso: string) => `${Number(iso.slice(8, 10))} ${SHORT_MONTHS[Number(iso.slice(5, 7)) - 1]}`;
const fullMonth = (ym: string) => `${FULL_MONTHS[Number(ym.slice(5, 7)) - 1]}`;
/** "$18.2k" beside a budget bar; smaller amounts in full. */
const shortMoney = (n: number, currency: string) => {
  if (Math.abs(n) < 1000) return moneyWords(n, currency);
  const k = n / 1000;
  const words = (Math.round(k * 10) / 10).toString();
  try {
    const symbol = new Intl.NumberFormat('en-AU', { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(0).replace(/[\d\s.,]/g, '');
    return `${symbol}${words}k`;
  } catch {
    return `$${words}k`;
  }
};

/** A bill's or payment's Account chosen from Finance's own accounts (8.0 Phase 5, "Bills rows set Account/Due"): the
 *  field offers every account by name, then "Something else…"; the Due day is a date field already. */
function withAccounts(fields: FieldInfo[], records: WsRecord[]): FieldInfo[] {
  const names = records.filter((r) => r.kind === 'account').map((r) => r.title);
  if (!names.length) return fields;
  const had = fields.find((f) => f.key === 'account');
  const account: FieldInfo = { key: 'account', label: had?.label ?? 'Account', type: 'status', values: [...new Set([...names, ...(had?.values ?? [])])] };
  return had ? fields.map((f) => (f.key === 'account' ? account : f)) : [...fields, account];
}

function useModuleCtx(records: WsRecord[]): RecordCtx {
  const canEdit = useApp((s) => s.canEdit);
  return useMemo(
    () => ({
      canEdit,
      fields: withAccounts(fieldsOf(records), records),
      editable: (r) => EDITABLE[r.kind] ?? [],
      setField: async (r, field, value) => {
        if (!r.path) return false;
        try {
          const said = await window.nv.recmod.setField(r.kind, r.path, field, value, r.ref?.at === 'table' ? r.ref.row : undefined);
          if (said) toast(said);
          moduleChanged();
          return true;
        } catch (err) {
          showError(err);
          return false;
        }
      },
      open: (r, e) => {
        if (!r.path) return;
        if (e?.ctrlKey || e?.metaKey || r.kind === 'spend') return A.openPath(r.path, { where: e?.ctrlKey || e?.metaKey ? 'tab' : 'current' });
        if (r.kind === 'bill') return openBill(r.path, r.title);
        peek({ type: 'note', path: r.path }, { title: r.title, type: 'note' });
      },
      plan: () => null,
      drop: () => undefined,
      byId: new Map(records.map((r) => [r.id, r])),
      people: [],
    }),
    [records, canEdit],
  );
}

/** A page's views: as first made, with the person's changes kept in the vault (module-options.json). */
function SectionViews({ module, section, records }: { module: RecordModule; section: string; records: WsRecord[] }) {
  const { options } = useModuleOptions();
  const made = useMemo(() => sectionViews(module.id, section === 'bills-table' ? 'bills' : section, todayIso()), [module.id, section]);
  const saved = options?.[module.id]?.views ?? {};
  return (
    <div className="rm-views">
      {made.map((first, i) => {
        const key = `${section}:${i}`;
        const def: RecordViewDef = saved[key] ? { ...cleanRecordView(saved[key]), scope: 'vault' } : first;
        const save = (next: RecordViewDef | null) =>
          void window.nv.recmod
            .setOptions(module.id, { views: { [key]: next } as Record<string, unknown> })
            .then(() => moduleChanged())
            .catch(showError);
        // A bill on each day it falls is still one bill.
        return <RecordView key={key} def={def} records={records} titled={made.length > 1} onChange={(d) => save(d)} onReset={saved[key] ? () => save(null) : undefined} counted={(rows) => new Set(rows.map((r) => (r.kind === 'bill' ? r.path : r.id))).size} />;
      })}
    </div>
  );
}

// ── Finance ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A bill's tag: the one shared bill-row state (9.2 uplift F3) — Paid plus its next day when just paid. */
const billTag = billRowTag;

const daysAgo = (today: string, n: number) => {
  const d = new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10)));
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** A row bill's menu (open it, open its list, take it out): never trash — a row is not a file. */
function billRowMenu(path: string, name: string, open: () => void): MenuItem[] {
  return [
    { label: `Open ${name}`, icon: 'notes', run: open },
    { label: 'Open the Bills list', icon: 'doc', run: () => A.openPath(path.split('#')[0], { where: 'tab' }) },
    { separator: true },
    {
      label: 'Delete',
      icon: 'trash',
      danger: true,
      disabled: !getState().canEdit,
      run: () =>
        void (async () => {
          try {
            const said = await window.nv.recmod.removeBill(path);
            toast(said);
            moduleChanged();
          } catch (err) {
            showError(err);
          }
        })(),
    },
  ];
}

/** One value on a bill changed where it shows (Nov 2026, "everything is editable where shown"): the one bills
 *  write (recmod:set-field), so a row and its page save the same way, with Undo on the toast. */
async function saveBillCell(b: Bill, field: string, value: string): Promise<boolean> {
  try {
    const said = await window.nv.recmod.setField('bill', b.path, field, value);
    if (said) toast(said);
    moduleChanged();
    return true;
  } catch (err) {
    showError(err);
    return false;
  }
}

/** One bill's row: its name, what it costs and when, marked paid where it sits (a project's Money tab reuses it).
 *  What it costs and when change here too (double-click, E or the pencil), through the bill's own write; how
 *  often and the account change on its page. */
export function BillRow({ b, currency, today, tile, brief, accounts, onOpen }: { b: Bill; currency: string; today: string; tile?: boolean; brief?: boolean; accounts?: string[]; onOpen?(): void }) {
  const canEdit = useApp((s) => s.canEdit);
  const tag = billTag(b, today);
  const open = onOpen ?? (() => openBill(b.path, b.name));
  const editor = useMemo(() => ({ path: b.path, canEdit, known: { people: [], tags: [] as string[] }, edit: async () => false }), [b.path, canEdit]);
  const amountText = b.amount !== null ? moneyWords(b.amount, currency) : null;
  const rest = brief ? [] : [b.cycle ? b.cycle.toLowerCase() : null, b.account].filter((x): x is string => !!x);
  return (
    <div className="trow" {...rowContext(() => [...(payableByHand(b, today) ? billPayMenu(b, accounts ?? [], currency) : []), ...(splitBillRow(b.path) ? billRowMenu(b.path, b.name, open) : rowMenu(b.path, b.name, open))])}>
      {!brief && payableByHand(b, today) ? <Tick label={`Mark ${b.name} paid`} onTick={() => markPaid(b)} /> : null}
      {!brief && b.autopay ? <span className="tag green">Autopay</span> : null}
      {tile ? (
        <span className={`gtile xs ${tag.tone}`} aria-hidden="true">
          $
        </span>
      ) : null}
      <button type="button" onClick={open} className="t" title={b.name} style={{ border: 0, background: 'none', padding: 0, font: 'inherit', color: 'inherit', cursor: 'pointer', textAlign: 'left' }}>
        {b.name}
      </button>
      <span className="end">
        <EditorContext.Provider value={editor}>
          {amountText || rest.length ? (
            <span className="meta">
              {amountText ? (canEdit ? <Inline value={String(b.amount)} label="Amount" compact onSave={(v) => saveBillCell(b, 'amount', v)}>{amountText}</Inline> : amountText) : null}
              {rest.map((r, i) => (
                <Fragment key={`${r}-${i}`}>
                  {amountText || i > 0 ? ' · ' : null}
                  {r}
                </Fragment>
              ))}
              {' ·'}
            </span>
          ) : null}
          {canEdit ? (
            <InlineDate value={b.anchor ?? ''} iso label="Due date" placeholder={tag.words} onSave={(v) => saveBillCell(b, 'due', v)}>
              <span className={`tag ${tag.tone}`}>{tag.words}</span>
            </InlineDate>
          ) : (
            <span className={`tag ${tag.tone}`}>{tag.words}</span>
          )}
        </EditorContext.Provider>
      </span>
    </div>
  );
}

function FinanceMain({ f, canEdit }: { f: FinanceView; canEdit: boolean }) {
  const modules = useModules();
  const cur = f.currency;
  const bills = partOn(modules, 'finance', 'bills');
  const spending = partOn(modules, 'finance', 'spending');
  const overdue = f.dueSoon.filter((b) => b.overdue);
  const week = f.dueSoon.filter((b) => !b.overdue && b.days !== null && b.days <= 7);
  const now = f.months.find((m) => m.month === f.thisMonth);
  const budgetTotal = f.budgets.reduce((s, b) => s + (b.monthly ?? 0), 0);
  const over = f.budgets.filter((b) => b.left !== null && b.left < 0);
  const onTrack = f.budgets.length - over.length;
  // Bills due first (late, today, then by day), then what was just paid.
  const due = attentionOrder(f.dueSoon.map((b) => ({ title: b.name, due: b.next, bill: b })), f.today).map(({ bill }) => bill);
  const paid = f.bills.filter((b) => b.paid && b.paid >= daysAgo(f.today, 7) && !f.dueSoon.includes(b)).slice(0, 3);
  const undated = f.bills.filter(b => !b.anchor && !b.paid && !/^(paused|cancelled|canceled|stopped|ended)$/i.test(b.status));
  const rows = [...due, ...paid].slice(0, 6);
  const facts: { k: string; v: ReactNode }[] = [];
  if (spending) facts.push({ k: `${fullMonth(f.thisMonth)} spend`, v: <span title="Added up from this month's spending.">{f.budgets.length ? `${moneyWords(now?.total ?? 0, cur)} of ${moneyWords(budgetTotal, cur)}` : moneyWords(now?.total ?? 0, cur)}</span> });
  if (bills)
    facts.push({
      k: 'Bills due',
      v: (
        <span title="Counted from your bills.">
          {overdue.length ? <span className="pill red">{`${overdue.length} late`}</span> : null}
          {week.length ? <span className="pill amber">{`${week.length} this week`}</span> : null}
          {!overdue.length && !week.length ? <span className="pill green">{f.bills.length ? 'None scheduled this week' : 'No bills'}</span> : null}
        </span>
      ),
    });
  if (spending && f.budgets.length > 0)
    facts.push({
      k: 'Budgets',
      v: <span title="Counted from your budgets.">{over.length ? <span className="pill red">{`${over.length} over`}</span> : <span className="pill green">{`${onTrack} on track`}</span>}</span>,
    });
  return (
    <PackShell glyph="$" tint="green" title={packName('finance', 'Money')} sub="Bills and subscriptions, spending and budgets." facts={facts} menu={() => financeMenu(f, canEdit)}>
      <BillsMoveCard f={f} canEdit={canEdit} />
      {(f.billsMove?.missingLists?.length ?? 0) > 0 && (
        <PackSection label="The list is missing">
          {(f.billsMove!.missingWords ?? []).map((w, i) => (
            <p key={i} className="vsub">{w}</p>
          ))}
          {f.billsMove!.undoable && canEdit && (
            <p className="sys-actions">
              <button type="button" className="button small primary" onClick={() => void didMove(window.nv.recmod.billsMoveUndo())}>
                Put them back
              </button>
            </p>
          )}
        </PackSection>
      )}
      {bills && rows.length > 0 && (
        <PackSection label="Bills due">
          {rows.map((b) => (
            <BillRow key={b.path} b={b} currency={cur} today={f.today} tile brief accounts={f.accounts.map((a) => a.name)} />
          ))}
        </PackSection>
      )}
      {bills && undated.length > 0 && <PackSection label="Needs a due date">{undated.map(b =>
        <BillRow key={b.path} b={b} currency={cur} today={f.today} tile brief accounts={f.accounts.map(a => a.name)} />
      )}</PackSection>}
      {bills && !rows.length && !undated.length && <PackSection label="Bills due" bare>{f.bills.length ? <p className="vsub">Nothing due in the next 14 days.</p> : <p className="vsub">Add your bills to see what is due here and on Today.</p>}</PackSection>}
      {bills && forecastHeadline(f.forecast, cur) && (
        <PackSection label="Looking ahead" bare>
          <p className="vsub">
            {forecastHeadline(f.forecast, cur)}. <button type="button" className="text-button" onClick={() => openModule('finance', 'lookahead')}>See the next 90 days</button>
          </p>
        </PackSection>
      )}
      {spending && f.budgets.length > 0 && (
        <PackSection label={`Budgets · ${fullMonth(f.thisMonth)}`}>
          {f.budgets.map((b) => (
            <div key={b.path} className={`p87-meter${b.left !== null && b.left < 0 ? ' over' : (b.progress ?? 0) >= 80 ? ' near' : ''}`}>
              <span className="nm">{b.category}</span>
              <span className="bar" aria-hidden="true">
                <span style={{ width: `${Math.min(100, Math.max(0, b.progress ?? 0))}%` }} />
              </span>
              <span className="amt">{b.monthly !== null ? `${shortMoney(b.spent, cur)} / ${shortMoney(b.monthly, cur)}` : 'No amount yet'}</span>
            </div>
          ))}
        </PackSection>
      )}
      {spending && !f.budgets.length && (
        <PackSection label={`Budgets · ${fullMonth(f.thisMonth)}`} bare>
          <p className="vsub">
            No budgets yet. <button type="button" className="btn quiet" style={{ height: 26 }} disabled={!canEdit} onClick={() => addBudget(f)}>Set one</button>
          </p>
        </PackSection>
      )}
      <AskFloat question={(w) => `About my money in Money (bills, spending, budgets): ${w}`} />
    </PackShell>
  );
}

function BillsPage({ f, canEdit }: { f: FinanceView; canEdit: boolean }) {
  const cur = f.currency;
  const live = (list: Bill[]) => attentionOrder(list.map((b) => ({ title: b.name, due: b.next, bill: b })), f.today).map(({ bill }) => bill);
  const kindBills = live(f.bills.filter((b) => b.kind === 'Bill'));
  const subs = live(f.bills.filter((b) => b.kind === 'Subscription'));
  const dueTotal = f.dueSoon.reduce((s, b) => s + (b.amount ?? 0), 0);
  const overdue = f.dueSoon.filter((b) => b.overdue).length;
  const month = billsMonthlyTotal(f.bills);
  const count = f.bills.filter((b) => b.monthly !== null).length;
  return (
    <PackShell
      glyph="$"
      tint="green"
      title="Bills"
      sub="Every bill and subscription: amount, how often, when due, which account."
      facts={[
        { k: 'Due next 14 days', v: <span title="Added up from your bills.">{`${moneyWords(dueTotal, cur)} · ${f.dueSoon.length} ${f.dueSoon.length === 1 ? 'bill' : 'bills'}${overdue ? ` · ${overdue} overdue` : ''}`}</span> },
        { k: 'Bills a month', v: <span title="Added up from your bills.">{`${moneyWords(month, cur)} · ${count} ${count === 1 ? 'bill or subscription' : 'bills and subscriptions'}`}</span> },
      ]}
      actions={
        <button type="button" className="btn pri" disabled={!canEdit} onClick={() => addBill(f)}>
          + New bill
        </button>
      }
      menu={() => financeMenu(f, canEdit)}
    >
      {/* Every bill, soonest first, beside SUBSCRIPTIONS (9.5 fvault F5: "DUE NOW" sat over bills months out and paid ones). */}
      <PackSection label="Bills">
        {kindBills.length ? (
          kindBills.map((b) => <BillRow key={b.path} b={b} currency={cur} today={f.today} accounts={f.accounts.map((a) => a.name)} />)
        ) : (
          <p className="vsub">No bills. Subscriptions sit below.</p>
        )}
      </PackSection>
      <PackSection label="Subscriptions">
        {subs.length ? (
          subs.map((b) => <BillRow key={b.path} b={b} currency={cur} today={f.today} accounts={f.accounts.map((a) => a.name)} />)
        ) : (
          <p className="vsub">No subscriptions.</p>
        )}
      </PackSection>
      {f.priceChanges.length > 0 && (
        <PackSection label="Price changes">
          {f.priceChanges.map((b) => (
            <div key={b.path} className="trow">
              <span className={`gtile xs ${b.change!.to > b.change!.from ? 'amber' : 'green'}`} aria-hidden="true">
                $
              </span>
              <button type="button" onClick={() => peek({ type: 'note', path: b.path }, { title: b.name, type: 'note' })} className="t" title={b.name} style={{ border: 0, background: 'none', padding: 0, font: 'inherit', color: 'inherit', cursor: 'pointer', textAlign: 'left' }}>
                {b.name}
              </button>
              <span className="end">
                <span className="meta">
                  {b.change!.to > b.change!.from ? 'went up' : 'went down'} from {moneyWords(b.change!.from, cur)} to {moneyWords(b.change!.to, cur)}
                  {b.change!.date ? ` on ${dueWords(b.change!.date, f.today)}` : ''}
                </span>
              </span>
            </div>
          ))}
        </PackSection>
      )}
      <p style={{ marginTop: 14 }}>
        <button type="button" className="btn quiet" onClick={() => openModule('finance', 'bills-table')}>
          See every bill as a table
        </button>
      </p>
    </PackShell>
  );
}

/** The next 90 days in one page: what goes out, what is expected in, the tightest week, and whether a cost fits. */
function LookaheadPage({ f, canEdit }: { f: FinanceView; canEdit: boolean }) {
  const [cost, setCost] = useState('');
  const fc = f.forecast;
  const amount = Number(cost.replace(/[^0-9.]/g, ''));
  const check = cost.trim() && Number.isFinite(amount) && amount > 0 ? affordCheck(fc, amount) : null;
  const biggest = biggestOut(fc.events);
  const max = Math.max(1, ...fc.weeks.map((w) => (w.balance !== null ? w.balance : w.net)));
  const min = Math.min(0, ...fc.weeks.map((w) => (w.balance !== null ? w.balance : w.net)));
  const span = Math.max(1, max - min);
  if (!fc.events.length && !fc.startingBalance)
    return (
      <PackShell glyph="$" tint="green" title="Next 90 days" sub="What goes out, what is expected in, and whether a cost fits." menu={() => financeMenu(f, canEdit)}>
        <EmptyState icon="calendar" title="Nothing to look ahead at yet" line="Add your bills to see the next 90 days here." action={{ label: 'Add your first bill', icon: 'plus', run: () => addBill(f), disabled: !canEdit }} />
      </PackShell>
    );
  return (
    <PackShell
      glyph="$"
      tint="green"
      title="Next 90 days"
      sub={
        <>
          {moneyWords(fc.totalOut, f.currency)} going out{fc.totalIn ? `, ${moneyWords(fc.totalIn, f.currency)} expected in` : ''}
          {fc.startingBalance !== null ? `, starting from ${moneyWords(fc.startingBalance, f.currency)} in your accounts` : ''}.
        </>
      }
      facts={[
        ...(fc.tightest ? [{ k: 'Tightest week', v: `${forecastWeekRange(fc.tightest)}${fc.tightest.balance !== null ? ` · ends at ${moneyWords(fc.tightest.balance, f.currency)}` : ` · ${moneyWords(fc.tightest.out, f.currency)} out`}` }] : []),
        ...(biggest ? [{ k: 'Biggest out', v: `${biggest.name}, ${moneyWords(biggest.amount, f.currency)} on ${shortDay(biggest.date)}` }] : []),
      ]}
      actions={
        <button type="button" className="btn" onClick={() => openModule('finance', 'calendar')}>
          Due dates
        </button>
      }
      menu={() => financeMenu(f, canEdit)}
    >
      <PackSection label="Balance by week" pad>
        <div className="p87-bars" role="img" aria-label="Balance by week for the next 90 days">
          {fc.weeks.map((w, i) => {
            const v = w.balance !== null ? w.balance : w.net;
            const tight = fc.tightest !== null && w.start === fc.tightest.start;
            const prev = i > 0 ? fc.weeks[i - 1].start : null;
            const label = !prev || w.start.slice(0, 7) !== prev.slice(0, 7) ? `${SHORT_MONTHS[Number(w.start.slice(5, 7)) - 1]} ${Number(w.start.slice(8, 10))}` : `${Number(w.start.slice(8, 10))}`;
            return (
              <div key={w.start} className={`b${tight ? ' tight' : ''}`} title={`${dueWords(w.start, f.today)} to ${dueWords(w.end, f.today)}: ${moneyWords(w.out, f.currency)} out${w.in ? `, ${moneyWords(w.in, f.currency)} in` : ''}${w.balance !== null ? `, ends at ${moneyWords(w.balance, f.currency)}` : ''}`}>
                <div className="fill" style={{ height: `${Math.max(6, Math.round(((v - min) / span) * 100))}%` }} />
                <span>{label}</span>
              </div>
            );
          })}
        </div>
      </PackSection>
      <PackSection label="Can we afford it" pad>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 600 }}>
            A cost to test
            <input className="input" inputMode="decimal" placeholder="900" value={cost} onChange={(e) => setCost(e.target.value)} aria-label="A cost to test, in dollars" style={{ width: 120 }} />
          </label>
          {check && !check.known && <span role="status" className="vsub">Not known yet: no pay or account balance is written to measure it against.</span>}
          {check && check.known && <span role="status" className={`tag ${check.ok ? 'green' : 'red'}`}>{check.ok ? `Yes · ${moneyWords(check.spare, f.currency)} to spare at the lowest point` : `Not yet · ${moneyWords(-check.spare, f.currency)} under at the lowest point`}</span>}
          {check && check.known && !check.balanceKnown && <span className="meta">On money in and out; no account balance is written.</span>}
        </div>
        {!fc.totalIn && fc.startingBalance === null && canEdit && (
          <p className="vsub" style={{ marginTop: 10 }}>
            Add your pay (or what is in your accounts) to see what is left each week.{' '}
            <button type="button" className="btn quiet" style={{ height: 26 }} onClick={() => financeOptions(f.currency, f.remindDays, f.income)}>
              Add your pay
            </button>
          </p>
        )}
      </PackSection>
    </PackShell>
  );
}

/** A move call done: its words toasted, Money re-read. */
async function didMove(p: Promise<string>): Promise<void> {
  try {
    toast(await p);
    moduleChanged();
  } catch (err) {
    showError(err);
  }
}

/** The one-time move to one Bills list, offered once on the Money page (it never runs by itself). */
function BillsMoveCard({ f, canEdit }: { f: FinanceView; canEdit: boolean }) {
  const [preview, setPreview] = useState<BillsMovePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const move = f.billsMove;
  if (!move) return null;
  const loadPreview = () => {
    setBusy(true);
    void window.nv.recmod.billsMovePreview().then(setPreview, showError).finally(() => setBusy(false));
  };
  const run = () => {
    setBusy(true);
    void window.nv.recmod.billsMoveRun().then(
      (words) => {
        moduleChanged();
        setPreview(null);
        toast(words, { label: 'Undo', run: () => void didMove(window.nv.recmod.billsMoveUndo()) }, 12000);
      },
      showError,
    ).finally(() => setBusy(false));
  };
  if (move.interrupted) {
    return (
      <PackSection label="Tidying up">
        <p className="vsub">The tidy-up did not finish. Nothing is half done: carry on, or put back what moved so far.</p>
        <p className="sys-actions">
          <button type="button" className="button small primary" disabled={!canEdit || busy} onClick={() => void didMove(window.nv.recmod.billsMoveResume())}>
            Carry on
          </button>
          <button type="button" className="button small" disabled={!canEdit || busy} onClick={() => void didMove(window.nv.recmod.billsMoveUndo())}>
            Put back
          </button>
        </p>
      </PackSection>
    );
  }
  if (move.done) {
    return (
      <PackSection label="Tidying up">
        <p className="vsub">
          Folded {move.done.folded} {move.done.folded === 1 ? 'note' : 'notes'} your assistant made into one Bills list you can read.
          {move.undoable && canEdit ? (
            <>
              {' '}
              <button type="button" className="text-button" onClick={() => void didMove(window.nv.recmod.billsMoveUndo())}>
                Put them back
              </button>
            </>
          ) : null}
        </p>
      </PackSection>
    );
  }
  if (preview) {
    const blocked = preview.pcsBlock ?? (preview.clash ? { names: [], words: preview.clash } : null);
    return (
      <PackSection label="Tidying up">
        {preview.words.map((w, i) => (
          <p key={i} className="vsub">{w}</p>
        ))}
        {blocked && <p className="rm-failed">{blocked.words}</p>}
        <div className="sys-move-lists">
          {!!preview.stay.length && (
            <div className="sys-move-group">
              <div className="glabel">Stay as notes ({preview.stay.length})</div>
              <ul className="sys-move-names">
                {preview.stay.map((s) => (
                  <li key={s.rel}>
                    <span className="t">{s.name}</span> <span className="meta">{s.why}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {!!preview.fold.length && (
            <div className="sys-move-group">
              <div className="glabel">Fold into the list ({preview.fold.length})</div>
              <ul className="sys-move-names">
                {preview.fold.map((s) => (
                  <li key={s.rel}>
                    <span className="t">{s.name}</span> <span className="meta">{s.why}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <p className="sys-actions">
          {!blocked && preview.fold.length > 0 && (
            <button type="button" className="button small primary" disabled={!canEdit || busy} onClick={run}>
              {busy ? 'Folding…' : 'Fold them into the list'}
            </button>
          )}
          <button type="button" className="button small" disabled={busy} onClick={() => setPreview(null)}>
            Back
          </button>
        </p>
      </PackSection>
    );
  }
  if (move.offer) {
    return (
      <PackSection label="Tidying up">
        <p className="vsub">
          Your assistant made {move.counts.fold} {move.counts.fold === 1 ? 'note' : 'notes'}. Fold them into one Bills list you can read, and keep the {move.counts.stay} with your words as notes?
        </p>
        <p className="sys-actions">
          <button type="button" className="button small" disabled={!canEdit || busy} onClick={loadPreview}>
            {busy ? 'Looking…' : 'See what would change'}
          </button>
          <button type="button" className="button small" disabled={!canEdit || busy} onClick={() => void didMove(window.nv.recmod.billsMoveDefer())}>
            Not now
          </button>
        </p>
      </PackSection>
    );
  }
  if (move.deferred && move.counts.fold > 0) {
    return (
      <p className="vsub">
        <button type="button" className="text-button" disabled={!canEdit || busy} onClick={loadPreview}>
          Fold assistant-made notes into one Bills list
        </button>
      </p>
    );
  }
  return null;
}

/** One bill's page, opened from its row: what it costs and when, marked paid where it sits. Writing on it
 *  makes it a note of its own. */
const BILLS_CONFLICT_LABELS: Record<string, string> = { kind: 'Kind', amount: 'Amount', cycle: 'How often', due: 'Due', category: 'Category', account: 'Account', project: 'Project', autopay: 'Autopay', status: 'Status', paid: 'Last paid', note: 'Note file' };

/** A bill changed on two PCs: each version with the facts where they differ, one choice, one button.
 *  Exported for tests/bills-conflict-card.test.mjs, which draws the real card in the headless shell. */
export function BillsConflictCard({ conflict, canEdit }: { conflict: BillsConflict; canEdit: boolean }) {
  const [keep, setKeep] = useState(0);
  const [busy, setBusy] = useState(false);
  const versions = [{ name: conflict.name, cells: conflict.kept, note: conflict.keptNote }, ...conflict.others];
  // A cell's plain words, as the Money page reads an account or project: a [[link]] reads as its name.
  // Compared and shown the same way, so versions differing only in brackets never read as a difference.
  const cellOf = (v: { cells: Record<string, string>; note: string | null }, k: string) => (k === 'note' ? (v.note ?? '') : linkName(v.cells[k] ?? ''));
  const keys = Object.keys(BILLS_CONFLICT_LABELS).filter((k) => new Set(versions.map((v) => cellOf(v, k))).size > 1);
  const nameDiffers = new Set(versions.map((v) => v.name)).size > 1;
  const choose = () => {
    if (busy) return;
    setBusy(true);
    void window.nv.recmod
      .billsResolveConflict(conflict.name, keep)
      .then(
        (r) => {
          moduleChanged();
          toast(r.words);
        },
        showError,
      )
      .finally(() => setBusy(false));
  };
  return (
    <PackSection label="Changed on two PCs">
      <p className="vsub">
        {conflict.name} was changed on two PCs, so the list keeps each version. You are seeing one of them. Choose which one to keep.
      </p>
      <ul className="sys-conflict-vers">
        {versions.map((v, i) => (
          <li key={i}>
            <label className={`sys-conflict-ver${keep === i ? ' is-on' : ''}`}>
              <span className="sys-conflict-head">
                <input type="radio" name={`bills-conflict-${conflict.name}`} checked={keep === i} onChange={() => setKeep(i)} disabled={!canEdit || busy} />
                {i === 0 ? 'Shown now' : versions.length === 2 ? 'The other version' : `Version ${i + 1}`}
              </span>
              <ul className="sys-conflict-facts">
                {nameDiffers && (
                  <li>
                    <span className="k">Name</span>
                    <span>{v.name}</span>
                  </li>
                )}
                {keys.map((k) => (
                  <li key={k}>
                    <span className="k">{BILLS_CONFLICT_LABELS[k]}</span>
                    <span>{cellOf(v, k) || 'Not set'}</span>
                  </li>
                ))}
              </ul>
            </label>
          </li>
        ))}
      </ul>
      <p className="sys-actions">
        <button type="button" className="button small primary" disabled={!canEdit || busy} onClick={choose}>
          {busy ? 'Keeping…' : 'Keep chosen'}
        </button>
      </p>
    </PackSection>
  );
}

const BILL_CYCLES = ['Weekly', 'Fortnightly', 'Monthly', 'Quarterly', 'Half-yearly', 'Yearly', 'Once'];

function BillPage({ b, f, canEdit }: { b: Bill; f: FinanceView; canEdit: boolean }) {
  const tag = billTag(b, f.today);
  const isRow = !!splitBillRow(b.path);
  const conflict = (f.billsConflicts ?? []).find((x) => billNameKey(x.name) === billNameKey(b.name)) ?? null;
  const [words, setWords] = useState('');
  const [busy, setBusy] = useState(false);
  const editor = useMemo(() => ({ path: b.path, canEdit, known: { people: [], tags: [] as string[] }, edit: async () => false }), [b.path, canEdit]);
  const saveWords = () => {
    const text = words.trim();
    if (!text || busy) return;
    setBusy(true);
    void window.nv.recmod.billNote(b.path, text).then(
      (rel) => {
        moduleChanged();
        setWords('');
        toast('It is a note of its own now.');
        A.openPath(rel, { where: 'current' });
      },
      showError,
    ).finally(() => setBusy(false));
  };
  const cur = f.currency;
  // Every fact changes where it sits (Nov 2026, "everything is editable where shown"), through the bill's own
  // write; Last paid is written by Mark paid, so it says so. Read-only, the facts read as they always did.
  const dueFact = canEdit ? (
    <InlineDate value={b.anchor ?? ''} iso label="Due date" placeholder={tag.words} onSave={(v) => saveBillCell(b, 'due', v)}>
      <span className={`pill ${tag.tone}`}>{tag.words}</span>
    </InlineDate>
  ) : (
    <span className={`pill ${tag.tone}`}>{tag.words}</span>
  );
  const amountFact = canEdit ? (
    <>
      <Inline value={b.amount !== null ? String(b.amount) : ''} label="Amount" compact placeholder="Set amount" onSave={(v) => saveBillCell(b, 'amount', v)}>
        {b.amount !== null ? moneyWords(b.amount, cur) : undefined}
      </Inline>
      {' · '}
      <Inline value={b.cycle} label="How often" compact suggest={BILL_CYCLES.map((value) => ({ value }))} onSave={(v) => saveBillCell(b, 'cycle', v)}>
        {b.cycle.toLowerCase()}
      </Inline>
    </>
  ) : b.amount !== null ? (
    `${moneyWords(b.amount, cur)} · ${b.cycle.toLowerCase()}`
  ) : (
    'Not set yet'
  );
  const textFact = (label: string, field: string, shown: string | null, placeholder: string, suggest?: { value: string }[]) =>
    canEdit ? (
      <Inline value={shown ?? ''} label={label} compact placeholder={placeholder} suggest={suggest} onSave={(v) => saveBillCell(b, field, v)}>
        {shown || undefined}
      </Inline>
    ) : (
      shown
    );
  return (
    <EditorContext.Provider value={editor}>
    <PackShell
      glyph="$"
      tint={tag.tone}
      title={b.name}
      sub={[b.kind, b.category].filter(Boolean).join(' · ') || 'A bill.'}
      facts={[
        { k: 'Due', v: dueFact },
        { k: 'Amount', v: amountFact },
        ...((b.account || canEdit) ? [{ k: 'Account', v: textFact('Account', 'account', b.account, 'Set the account') }] : []),
        ...((b.category || canEdit) ? [{ k: 'Category', v: textFact('Category', 'category', b.category || null, 'Set the category') }] : []),
        ...((b.project || canEdit) ? [{ k: 'Project', v: textFact('Project', 'project', b.project, 'Link a project') }] : []),
        { k: 'Autopay', v: textFact('Autopay', 'autopay', b.autopay ? 'Yes' : 'No', 'Yes or no', [{ value: 'Yes' }, { value: 'No' }]) },
        ...(b.paid ? [{ k: 'Last paid', v: <span title="Written when the bill is marked paid.">{longDay(b.paid)}</span> }] : []),
      ]}
      actions={payableByHand(b, f.today) ? <button type="button" className="btn pri" disabled={!canEdit} onClick={() => markPaid(b)}>Mark paid</button> : undefined}
      menu={() => [
        { label: packName('finance', 'Money'), icon: 'wallet', run: () => openModule('finance', 'overview') },
        { label: 'Bills', icon: 'receipt', run: () => openModule('finance', 'bills') },
        { separator: true },
        ...(isRow
          ? [
              { label: 'Open the Bills list', icon: 'doc' as const, run: () => A.openPath(b.path.split('#')[0], { where: 'tab' }) },
              { label: 'Keep a file with it…', icon: 'paperclip' as const, disabled: !canEdit, run: () => void keepFileWith(b.path, b.name) },
              ...(payableByHand(b, f.today) ? [{ label: 'Mark paid…', icon: 'check' as const, disabled: !canEdit, run: () => markPaid(b) }] : []),
              { separator: true as const },
              {
                label: 'Delete',
                icon: 'trash' as const,
                danger: true,
                disabled: !canEdit,
                run: () =>
                  void (async () => {
                    try {
                      const said = await window.nv.recmod.removeBill(b.path);
                      toast(said);
                      moduleChanged();
                      openModule('finance', 'bills');
                    } catch (err) {
                      showError(err);
                    }
                  })(),
              },
            ]
          : [
              { label: 'Open its note', icon: 'doc' as const, run: () => A.openPath(b.path, { where: 'tab' }) },
              { label: 'Keep a file with it…', icon: 'paperclip' as const, disabled: !canEdit, run: () => void keepFileWith(b.path, b.name) },
              { separator: true as const },
              { label: 'Delete', icon: 'trash' as const, danger: true, disabled: !canEdit, run: () => void A.trashPath(b.path).catch(showError) },
            ]),
      ]}
    >
      {conflict && <BillsConflictCard conflict={conflict} canEdit={canEdit} />}
      <PackSection label="Price history">
        {b.history.length ? (
          b.history.map((h, i) => (
            <div key={i} className="trow">
              <span className="t">{h.note || 'Price recorded'}</span>
              <span className="end">
                {h.date ? <span className="meta">{shortDay(h.date)} ·</span> : null}
                <span className="meta">{moneyWords(h.amount, cur)}</span>
              </span>
            </div>
          ))
        ) : (
          <p className="vsub">No price changes recorded.</p>
        )}
      </PackSection>
      <PackSection label="Notes">
        {isRow ? (
          <>
            <p className="vsub">Write about {b.name}. The first words make it a note of its own.</p>
            <textarea className="sys-notes-box" value={words} rows={3} placeholder={`Something about ${b.name}…`} aria-label={`Notes about ${b.name}`} disabled={!canEdit || busy} onChange={(e) => setWords(e.target.value)} />
            <p className="sys-actions">
              <button type="button" className="button small" disabled={!canEdit || !words.trim() || busy} onClick={saveWords}>
                {busy ? 'Writing…' : 'Write it down'}
              </button>
            </p>
          </>
        ) : (
          <>
            <p className="vsub">Its notes live in its note.</p>
            <p>
              <button type="button" className="btn" onClick={() => A.openPath(b.path, { where: 'current' })}>
                Open its note
              </button>
            </p>
          </>
        )}
      </PackSection>
      <AskFloat question={(w) => `About ${b.name} in Money: ${w}`} />
    </PackShell>
    </EditorContext.Provider>
  );
}

/** Every Finance page and action in the one menu, so nothing is more than a tap away. */
function financeMenu(f: FinanceView | null, canEdit: boolean): import('../../components/Menu').MenuItem[] {
  if (!f) return [];
  const name = packName('finance', 'Money');
  return [
    { label: name, icon: 'wallet', run: () => openModule('finance', 'overview') },
    { label: 'Bills', icon: 'receipt', run: () => openModule('finance', 'bills') },
    { label: 'Next 90 days', icon: 'calendar', run: () => openModule('finance', 'lookahead') },
    { label: 'Due dates', icon: 'calendar', run: () => openModule('finance', 'calendar') },
    { label: 'Spending', icon: 'chart', run: () => openModule('finance', 'spending') },
    { label: 'Budgets', icon: 'target', run: () => openModule('finance', 'budgets') },
    { label: 'Accounts', icon: 'bank', run: () => openModule('finance', 'accounts') },
    { label: 'Receipts', icon: 'file', run: () => openModule('finance', 'receipts') },
    { separator: true },
    { label: 'New bill or subscription', icon: 'receipt', disabled: !canEdit, run: () => addBill(f) },
    { label: 'New payment', icon: 'wallet', disabled: !canEdit, run: () => addPayment(f) },
    { label: 'New budget', icon: 'target', disabled: !canEdit, run: () => addBudget(f) },
    { label: 'New account', icon: 'bank', disabled: !canEdit, run: () => void addAccount() },
    { separator: true },
    { label: 'Add from a file…', icon: 'files', disabled: !canEdit, run: () => void addFromFiles(name, f.folder, 'add each bill, subscription and repayment in them to Money (amount, how often, the next due day, category, autopay), and the month\'s spending when it is a statement.') },
    { label: 'Import your bank’s CSV…', icon: 'upload', disabled: !canEdit, run: () => void importBankCsv(f) },
    { separator: true },
    { label: `${name} options…`, icon: 'settings', disabled: !canEdit, run: () => financeOptions(f.currency, f.remindDays, f.income) },
    { label: 'Show the folder', icon: 'folder', run: () => A.revealInExplorer(f.folder) },
    { separator: true },
    { label: `Show me around ${name}`, icon: 'help', run: () => openTour('finance') },
  ];
}

export function FinancePage({ tab }: { tab: W.TabState }) {
  const canEdit = useApp((s) => s.canEdit);
  const modules = useModules();
  const { data: f, error } = useFinance();
  const records = useMemo(() => (f ? financeRecords(f) : []), [f]);
  // The due-date calendar: each bill on every day it falls (a monthly one in every month).
  const calendarRecords = useMemo(() => (f ? [...billDays(f), ...records.filter((r) => r.kind !== 'bill')] : []), [f, records]);
  const sections = [...FINANCE.sections, { id: 'lookahead', label: 'Next 90 days', icon: 'calendar', line: 'What goes out, what is expected in, and whether a cost fits.' }, { id: 'bills-table', label: 'Bills table', icon: 'table', line: 'Every bill as a table.' }].filter((s) => s.id === 'overview' || partOn(modules, 'finance', FINANCE_PART[s.id] ?? 'bills'));
  const section = partOfTab(tab) ?? 'overview';
  const detail = /^bill:(.+)$/.exec(section);
  const bill = detail && f ? f.bills.find((b) => b.path === decodeURIComponent(detail[1]) || b.rowPath === decodeURIComponent(detail[1])) ?? null : null;
  const here = sections.some((s) => s.id === section) ? section : 'overview';
  const ctx = useModuleCtx(here === 'calendar' ? calendarRecords : records);
  const empty = f && !f.bills.length && !f.accounts.length && !f.budgets.length && !f.spending.length;
  const info = sections.find((s) => s.id === here) ?? sections[0];
  return (
    <RecordContext.Provider value={ctx}>
      {error ? (
        <div className="nv-page full p87">
          <p className="rm-failed">{error}</p>
        </div>
      ) : !f ? (
        <div className="nv-page full p87">
          <div className="view-loading" />
        </div>
      ) : detail ? (
        bill ? (
          <BillPage b={bill} f={f} canEdit={canEdit} />
        ) : (
          <PackShell glyph="$" tint="slate" title="Not here any more" sub="It may have been taken out of the list." menu={() => financeMenu(f, canEdit)}>
            <p>
              <button type="button" className="btn" onClick={() => openModule('finance', 'bills')}>
                All bills
              </button>
            </p>
          </PackShell>
        )
      ) : empty && here === 'overview' ? (
        <PackShell glyph="$" tint="green" title={packName('finance', 'Money')} sub="Bills and subscriptions, spending and budgets." menu={() => financeMenu(f, canEdit)}>
          <EmptyState icon="wallet" title="Your money, in one place" line="Add your bills and subscriptions to see what’s due on Today and in the bell, and import your bank’s CSV to see where it goes each month." action={{ label: 'Add your first bill', icon: 'plus', run: () => addBill(f), disabled: !canEdit }} also={partOn(modules, 'finance', 'spending') ? { label: 'Import your bank’s CSV', icon: 'upload', run: () => void importBankCsv(f), disabled: !canEdit } : undefined} />
        </PackShell>
      ) : here === 'overview' ? (
        <FinanceMain f={f} canEdit={canEdit} />
      ) : here === 'bills' ? (
        <BillsPage f={f} canEdit={canEdit} />
      ) : here === 'lookahead' ? (
        <LookaheadPage f={f} canEdit={canEdit} />
      ) : (
        <PackShell glyph="$" tint="green" title={info.label} sub={info.line} menu={() => financeMenu(f, canEdit)}>
          <SectionViews module={FINANCE} section={here} records={here === 'calendar' ? calendarRecords : records} />
        </PackShell>
      )}
      <BankImportHost />
      <RecordFormHost />
    </RecordContext.Provider>
  );
}

// ── Documents and ID ───────────────────────────────────────────────────────────────────────────────────────────────

const docTone = (d: IdDocument): Tint => (d.status === 'Expired' ? 'red' : d.status === 'Expires soon' ? 'amber' : d.status === 'Valid' || d.status === 'Renewed' ? 'green' : 'slate');

/** How long a renewed document runs: "10 years", "3 years", "14 months". */
function validityWords(issued: string, expires: string): string {
  const months = (Number(expires.slice(0, 4)) - Number(issued.slice(0, 4))) * 12 + (Number(expires.slice(5, 7)) - Number(issued.slice(5, 7)));
  if (months >= 24 && months % 12 === 0) return `${months / 12} years`;
  if (months >= 18) return `${Math.round(months / 12)} years`;
  return `${months} ${months === 1 ? 'month' : 'months'}`;
}

/** Identity, Licences, Policies, Certificates, CV versions, then anything else by its kind. A Certificate is
 *  its own group (packs uplift item 9): it is not a licence. */
function kindGroup(kind: string): string {
  if (['Passport', 'ID card', 'Birth certificate', 'Medicare card', 'Visa'].includes(kind)) return 'Identity';
  if (kind === 'Driver licence') return 'Licences';
  if (kind === 'Certificate') return 'Certificates';
  if (kind === 'Insurance policy') return 'Policies';
  if (kind === 'CV') return 'CV versions';
  return kind;
}

function DocRow({ d, today, canEdit, fresh }: { d: IdDocument; today: string; canEdit: boolean; fresh?: boolean }) {
  const tone = docTone(d);
  const open = () => openModule('documents', `doc:${encodeURIComponent(d.path)}`);
  // "expired 12 Oct · Renew", "expires 18 Dec · 51 days", "renewed 21 Oct · 10 years".
  const meta = fresh && d.issued ? `renewed ${shortDay(d.issued)}` : d.status === 'Expired' && d.expires ? `expired ${shortDay(d.expires)}` : d.status === 'Expires soon' && d.expires ? `expires ${shortDay(d.expires)}` : d.status === 'Renewed' && d.issued ? `renewed ${shortDay(d.issued)}` : expiryWords(d, today);
  const tag = d.status === 'Expired' ? 'Renew' : d.status === 'Expires soon' && d.days !== null ? `${d.days} ${d.days === 1 ? 'day' : 'days'}` : (d.status === 'Renewed' || fresh) && d.issued && d.expires ? validityWords(d.issued, d.expires) : d.status;
  const menu = () => [
    { label: `Open ${d.name}`, icon: 'idcard' as const, run: open },
    { label: 'Open its note', icon: 'doc' as const, run: () => A.openPath(d.path, { where: 'tab' }) },
    ...(d.expires && d.status !== 'Renewed' ? [{ label: 'Renewed', icon: 'check' as const, disabled: !canEdit, run: () => renewDocument(d) }] : []),
    { separator: true as const },
    { label: 'Delete', icon: 'trash' as const, danger: true, disabled: !canEdit, run: () => void A.trashPath(d.path).catch(showError) },
  ];
  return (
    <div className="trow" {...rowContext(menu)}>
      <span className={`gtile xs ${tone}`} aria-hidden="true">
        ▤
      </span>
      <button type="button" onClick={open} className="t" title={d.name} style={{ border: 0, background: 'none', padding: 0, font: 'inherit', color: 'inherit', cursor: 'pointer', textAlign: 'left' }}>
        {d.name}
      </button>
      <span className="end">
        {meta.toLowerCase() !== tag.toLowerCase() && <span className="meta">{meta}</span>}
        {d.status === 'Expired' ? (
          <button type="button" className={`tag ${tone}`} style={{ border: 0, cursor: 'pointer', font: 'inherit' }} disabled={!canEdit} onClick={() => renewDocument(d)} title={`Record that ${d.name} was renewed`}>
            {tag}
          </button>
        ) : (
          <span className={`tag ${tone}`}>{tag}</span>
        )}
      </span>
    </div>
  );
}

function DocumentsMain({ m, canEdit }: { m: DocumentsView; canEdit: boolean }) {
  // Just renewed (a fresh issue day): shown green with how long it runs, below what needs renewing.
  const fresh = m.documents.filter((d) => d.status === 'Valid' && d.issued && d.expires && d.issued >= daysAgo(m.today, 30));
  const expired = m.documents.filter((d) => d.status === 'Expired');
  const soon = m.documents.filter((d) => d.status === 'Expires soon');
  const groups = ['Identity', 'Licences', 'Policies', 'Certificates', 'CV versions'];
  const rest = [...new Set(m.documents.map((d) => kindGroup(d.kind)))].filter((g) => !groups.includes(g));
  return (
    <PackShell
      glyph="▤"
      tint="slate"
      title={packName('documents', 'Papers')}
      sub="Passports, licences, policies and certificates. Numbers stay locked away."
      facts={[
        {
          k: 'Expiring soon',
          v: (
            <>
              {expired.length ? <span className="pill red">{`${expired.length} expired`}</span> : null}
              {soon.length ? <span className="pill amber">{`${soon.length} within 60 days`}</span> : null}
              {!expired.length && !soon.length ? <span className="pill green">Nothing expiring</span> : null}
            </>
          ),
        },
        { k: 'Kept', v: `${m.documents.length} ${m.documents.length === 1 ? 'document' : 'documents'}${m.cvs.length ? ` · ${m.cvs.length} CV ${m.cvs.length === 1 ? 'version' : 'versions'}` : ''}` },
      ]}
      actions={
        <button type="button" className="btn pri" disabled={!canEdit} onClick={() => void addDocument()}>
          + Add a document
        </button>
      }
      menu={() => documentsMenu(m, canEdit)}
    >
      <PackSection label="Expiring soon">
        {m.expiring.length || fresh.length ? (
          <>
            {m.expiring.map((d) => (
              <DocRow key={d.path} d={d} today={m.today} canEdit={canEdit} />
            ))}
            {fresh.map((d) => (
              <DocRow key={d.path} d={d} today={m.today} canEdit={canEdit} fresh />
            ))}
          </>
        ) : (
          <p className="vsub">Nothing expiring soon.</p>
        )}
      </PackSection>
      <PackSection label="Every document by kind">
        {[...groups, ...rest].map((g) => {
          const list = m.documents.filter((d) => kindGroup(d.kind) === g);
          if (!list.length) return null;
          // A pack for finding papers lists them (packs uplift item 9): the group head keeps its count and its
          // link to the full list, and every document below it opens.
          const words = g === 'CV versions' ? `${list[0].version || list[0].name} current · ${plural(list.length, 'version')}` : plural(list.length, 'document');
          return (
            <Fragment key={g}>
              <div className="trow">
                <button type="button" onClick={() => openModule('documents', g === 'CV versions' ? 'cv' : 'all')} className="t" style={{ border: 0, background: 'none', padding: 0, font: 'inherit', fontWeight: 600, color: 'inherit', cursor: 'pointer', textAlign: 'left' }}>
                  {g}
                </button>
                <span className="end">
                  <span className="meta">{words}</span>
                </span>
              </div>
              {list.map((d) => (
                <DocRow key={d.path} d={d} today={m.today} canEdit={canEdit} />
              ))}
            </Fragment>
          );
        })}
      </PackSection>
    </PackShell>
  );
}

/** What links to a document (a trip that uses the passport, an application that went with the CV). */
function useLinked(path: string): { title: string; path: string }[] {
  const [linked, setLinked] = useState<{ title: string; path: string }[]>([]);
  const revision = useApp((s) => s.revision);
  useEffect(() => {
    let live = true;
    void window.nv.index
      .backlinks(path)
      .then((rows) => live && setLinked(rows.map((r) => ({ title: r.sourceTitle || r.source.split('/').pop()!.replace(/\.md$/i, ''), path: r.source })).filter((r) => r.path !== path).slice(0, 8)), () => undefined);
    return () => void (live = false);
  }, [path, revision]);
  return linked;
}

function DocumentPage({ d, m, canEdit }: { d: IdDocument; m: DocumentsView; canEdit: boolean }) {
  const tone = docTone(d);
  const linked = useLinked(d.path);
  const numberWords = d.secret ? (
    <>
      Locked away <span className="meta">· unlock to view</span>
    </>
  ) : d.plainNumber ? (
    'Written in the note · move it to Secrets'
  ) : (
    'Not kept yet'
  );
  return (
    <PackShell
      glyph="▤"
      tint={tone}
      title={d.name}
      sub={[d.kind, d.issuer ? `issued by ${d.issuer}` : null].filter(Boolean).join(', ') || 'A kept document.'}
      sharePath={d.path}
      facts={[
        { k: 'Status', v: <span className={`pill ${tone}`}>{d.status === 'Renewed' && d.issued ? `Renewed ${shortDay(d.issued)}` : d.status === 'Valid' ? 'Valid' : d.status}</span> },
        ...(d.expires ? [{ k: 'Expires', v: `${longDay(d.expires)} · reminder ${plural(d.remind, 'day')} before` }] : d.kind === 'CV' ? [{ k: 'Written', v: d.issued ? dueWords(d.issued, m.today) : d.version || 'CV' }] : []),
        {
          k: 'Number',
          v: (
            <button type="button" className="btn quiet" style={{ height: 26 }} onClick={() => documentNumber(d)}>
              {d.secret ? <Icon name="lock" size={12} /> : <Icon name="key" size={12} />} {numberWords}
            </button>
          ),
        },
      ]}
      menu={() => [
        { label: packName('documents', 'Papers'), icon: 'idcard', run: () => openModule('documents', 'overview') },
        { separator: true },
        { label: 'Open its note', icon: 'doc', run: () => A.openPath(d.path, { where: 'tab' }) },
        { label: 'Keep a file with it…', icon: 'paperclip', disabled: !canEdit, run: () => void keepFileWith(d.path, d.name) },
        ...(d.expires && d.status !== 'Renewed' ? [{ label: 'Renewed', icon: 'check' as const, disabled: !canEdit, run: () => renewDocument(d) }] : []),
        { separator: true },
        { label: 'Delete', icon: 'trash', danger: true, disabled: !canEdit, run: () => void A.trashPath(d.path).catch(showError) },
      ]}
    >
      {d.status === 'Renewed' && d.expires && (
        <div className="callout green" style={{ marginTop: 14 }}>
          <span aria-hidden="true">✓</span>
          <span>
            <b>Renewed.</b> New expiry {longDay(d.expires)}. The old scan stays below for reference.
          </span>
        </div>
      )}
      <PackSection label="Files">
        {d.files.length ? (
          d.files.map((file) => (
            <div key={file} className="trow">
              <span className="gtile xs slate" aria-hidden="true">
                ▤
              </span>
              <button type="button" onClick={() => A.openPath(file, { where: 'current' })} className="t" title={file} style={{ border: 0, background: 'none', padding: 0, font: 'inherit', color: 'inherit', cursor: 'pointer', textAlign: 'left' }}>
                {file.split('/').pop()}
              </button>
              {/old|expired|previous|superseded|archive/i.test(file) ? (
                <span className="end">
                  <span className="meta">kept for reference</span>
                </span>
              ) : null}
            </div>
          ))
        ) : (
          <p className="vsub">No files kept with it yet.</p>
        )}
      </PackSection>
      <PackSection label="Linked">
        {linked.length ? (
          linked.map((l) => (
            <div key={l.path} className="trow">
              <span className="gtile xs slate" aria-hidden="true">
                ✎
              </span>
              <button type="button" onClick={() => A.openPath(l.path, { where: 'current' })} className="t" title={l.title} style={{ border: 0, background: 'none', padding: 0, font: 'inherit', color: 'inherit', cursor: 'pointer', textAlign: 'left' }}>
                {l.title}
              </button>
              <span className="end">
                <span className="meta">uses this {d.kind.toLowerCase()}</span>
              </span>
            </div>
          ))
        ) : (
          <p className="vsub">Nothing links to it yet.</p>
        )}
      </PackSection>
      <AskFloat question={(w) => `About ${d.name} in Papers: ${w}`} />
    </PackShell>
  );
}

function documentsMenu(m: DocumentsView | null, canEdit: boolean): import('../../components/Menu').MenuItem[] {
  if (!m) return [];
  const name = packName('documents', 'Papers');
  return [
    { label: name, icon: 'idcard', run: () => openModule('documents', 'overview') },
    { label: 'All documents', icon: 'table', run: () => openModule('documents', 'all') },
    { label: 'Expiry', icon: 'calendar', run: () => openModule('documents', 'expiry') },
    { label: 'CV versions', icon: 'history', run: () => openModule('documents', 'cv') },
    { separator: true },
    { label: 'New document', icon: 'idcard', disabled: !canEdit, run: () => void addDocument() },
    { label: 'New CV version', icon: 'doc', disabled: !canEdit, run: () => void addDocument({ kind: 'CV' }) },
    { separator: true },
    { label: 'Add from a file…', icon: 'files', disabled: !canEdit, run: () => void addFromFiles(name, m.folder, 'add each document in them to Papers (what it is, whose it is, its issuer, and its issue and expiry dates) and keep each file with its document. Never write a document number anywhere or say one back: numbers go in Secrets in the window, by the person.') },
    { separator: true },
    { label: `${name} options…`, icon: 'settings', disabled: !canEdit, run: () => documentOptions(m.remindDays) },
    { label: 'Open Locked', icon: 'key', run: () => A.openLocked('secrets') },
    { label: 'Show the folder', icon: 'folder', run: () => A.revealInExplorer(m.folder) },
    { separator: true },
    { label: `Show me around ${name}`, icon: 'help', run: () => openTour('documents') },
  ];
}

export function DocumentsPage({ tab }: { tab: W.TabState }) {
  const canEdit = useApp((s) => s.canEdit);
  const { data: m, error } = useDocuments();
  const records = useMemo(() => (m ? documentRecords(m) : []), [m]);
  const ctx = useModuleCtx(records);
  const part = partOfTab(tab) ?? 'overview';
  const detail = /^doc:(.+)$/.exec(part);
  const doc = detail && m ? m.documents.find((d) => d.path === decodeURIComponent(detail[1])) ?? m.cvs.find((d) => d.path === decodeURIComponent(detail[1])) ?? null : null;
  const here = DOCUMENTS.sections.some((s) => s.id === part) ? part : 'overview';
  const info = DOCUMENTS.sections.find((s) => s.id === here) ?? DOCUMENTS.sections[0];
  return (
    <RecordContext.Provider value={ctx}>
      {error ? (
        <div className="nv-page full p87">
          <p className="rm-failed">{error}</p>
        </div>
      ) : !m ? (
        <div className="nv-page full p87">
          <div className="view-loading" />
        </div>
      ) : detail ? (
        doc ? (
          <DocumentPage d={doc} m={m} canEdit={canEdit} />
        ) : (
          <PackShell glyph="▤" tint="slate" title="Not here any more" sub="It may have been moved to Recently deleted." menu={() => documentsMenu(m, canEdit)}>
            <p>
              <button type="button" className="btn" onClick={() => openModule('documents', 'overview')}>
                All documents
              </button>
            </p>
          </PackShell>
        )
      ) : !m.documents.length && here === 'overview' ? (
        <PackShell glyph="▤" tint="slate" title={packName('documents', 'Papers')} sub="Passports, licences, policies and certificates. Numbers stay locked away." menu={() => documentsMenu(m, canEdit)}>
          <EmptyState icon="idcard" title="Your documents, and when they expire" line="Add a passport, licence, certificate or insurance policy to be reminded before it expires. Numbers are kept in your locked Secrets." action={{ label: 'Add your first document', icon: 'plus', run: () => addDocument(), disabled: !canEdit }} also={{ label: 'Add a CV version', icon: 'doc', run: () => addDocument({ kind: 'CV' }), disabled: !canEdit }} />
        </PackShell>
      ) : here === 'overview' ? (
        <DocumentsMain m={m} canEdit={canEdit} />
      ) : (
        <PackShell glyph="▤" tint="slate" title={info.label} sub={info.line} menu={() => documentsMenu(m, canEdit)}>
          <SectionViews module={DOCUMENTS} section={here} records={records} />
        </PackShell>
      )}
      <RecordFormHost />
    </RecordContext.Provider>
  );
}
