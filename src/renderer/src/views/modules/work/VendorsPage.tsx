// Vendors, Quotes and Contracts (Wave 6 part b; src/shared/work-vendors.ts, src/main/work/vendors.ts). One page made of
// the work modules' blocks (WorkShell): Overview says what lapses or ends soon with its one action beside it, then the
// record views of vendors, quotes, purchase orders and contracts (each changeable where it shows, kept as the person
// leaves it), quotes compared side by side, and a page of its own for a vendor, a quote and a contract where every value
// changes where it is shown. Today shows what lapses or ends (VendorsToday).

import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { partOn } from '../../../../../shared/life-modules';
import { dueWords, moneyWords, whenWords } from '../../../../../shared/finance';
import { whenWords as lateWords } from '../../../../../shared/module-purpose';
import { plural } from '../../../../../shared/words';
import { CONTRACT_PERIODS, CONTRACT_RENEWALS, CONTRACT_STATUSES, PO_STATUSES, QUOTE_STATUSES, VENDOR_CATEGORIES, VENDOR_STATUSES, VENDORS } from '../../../../../shared/work-modules';
import { compareQuotes, VENDOR_EDITABLE, vendorRecords, vendorSectionViews, type Contract, type PurchaseOrder, type Quote, type Vendor, type VendorsModel } from '../../../../../shared/work-vendors';
import { EmptyState } from '../../../components/EmptyState';
import { Icon, type IconName } from '../../../components/Icon';
import { openMenu, type MenuItem } from '../../../components/Menu';
import * as A from '../../../state/actions';
import { takeOffAria, takeOffSaid } from '../../../lib/removeWords';
import { openTour } from '../../../state/moduleFills';
import { openModule, useModules } from '../../../state/modules';
import { peek } from '../../../state/peek';
import { showError, useApp } from '../../../state/store';
import { useWork, useWorkOptions, workCall, workDid } from '../../../state/workModules';
import type * as W from '../../../state/workspace';
import { setRecordCurrency } from '../../workspace/recordParts';
import { openRecordForm, valueNumber, valueWords } from '../RecordForm';
import { AskFloat, PackSection, PackShell, monthYear, packName, rowContext, rowMenu, shortDay, weekdayLong, type Tint } from '../pack87';
import { Card, dayText, openDetail, Pill, placeOf, sameRecord, Tile, todayIso, useWorkCtx, WithRecords, WorkViews } from './WorkShell';
import { isEnterKey } from '../../../lib/enterKey';

type View = VendorsModel & { currency: string; folder: string; projects: { path: string; name: string }[] };
type Tone = 'ok' | 'warn' | 'bad' | 'next' | 'none';

const call = <T,>(name: string, ...args: unknown[]) => workCall<T>('vendors', name, ...args);
const quoteTone = (s: string): Tone => (s === 'Lapsed' ? 'bad' : s === 'Lapses soon' ? 'warn' : s === 'Accepted' ? 'ok' : s === 'Valid' ? 'next' : 'none');
const contractTone = (s: string): Tone => (s === 'Ended' ? 'none' : s === 'In notice period' || s === 'Ending' ? 'warn' : s === 'Notice period soon' ? 'warn' : s === 'Active' ? 'ok' : 'none');
const orderTone = (o: PurchaseOrder): Tone => (o.late ? 'bad' : o.status === 'Paid' ? 'ok' : o.status === 'Cancelled' ? 'none' : 'next');
/** An amount as the module shows it: whole dollars without cents, otherwise to the cent ("$9,400", "$450.50"). */
function cash(n: number | null | undefined, cur = 'AUD'): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '';
  try {
    return new Intl.NumberFormat('en-AU', { style: 'currency', currency: cur, minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 }).format(n);
  } catch {
    return moneyWords(n, cur);
  }
}
const say = (s: string, n: number, many = `${s}s`) => `${n} ${n === 1 ? s : many}`;

function useOn() {
  const modules = useModules();
  return { orders: partOn(modules, 'vendors', 'orders'), contracts: partOn(modules, 'vendors', 'contracts') };
}

// ── Doing things ─────────────────────────────────────────────────────────────────────────────────────────────────────

const setField = (kind: string, path: string, field: string, value: unknown) => workDid(call<string | null>('set-field', { kind, path, field, value })).then((r) => r !== null);

function addVendor(prefill: { name?: string } = {}): void {
  openRecordForm({
    title: 'New vendor',
    icon: 'briefcase',
    line: 'Who they are and how to reach them. Their quotes, orders and contracts gather on their page.',
    ok: 'Add vendor',
    fields: [
      { key: 'name', label: 'Name', kind: 'text', required: true, wide: true, placeholder: 'Northwind Builders', value: prefill.name ?? '' },
      { key: 'category', label: 'What they supply', kind: 'choice', options: [...VENDOR_CATEGORIES], value: 'Other' },
      { key: 'status', label: 'Status', kind: 'choice', options: [...VENDOR_STATUSES], value: 'Active' },
      { key: 'contact', label: 'Contact person', kind: 'text', placeholder: 'Their name (linked to People)' },
      { key: 'email', label: 'Email', kind: 'text' },
      { key: 'phone', label: 'Phone', kind: 'text' },
      { key: 'website', label: 'Website', kind: 'text' },
    ],
    submit: async (v) => {
      const rel = await call<string>('add-vendor', { name: valueWords(v, 'name'), category: valueWords(v, 'category'), status: valueWords(v, 'status'), contact: valueWords(v, 'contact'), email: valueWords(v, 'email'), phone: valueWords(v, 'phone'), website: valueWords(v, 'website') });
      void workDid(Promise.resolve(rel), `Added ${valueWords(v, 'name')}.`, { label: 'Open', run: () => openDetail('vendors', 'vendor', rel) });
    },
  });
}

function addQuote(m: View | null, prefill: { vendor?: string; project?: string } = {}): void {
  const vendors = m?.vendors.map((x) => x.name) ?? [];
  const projects = m?.projects.map((p) => p.name) ?? [];
  const cur = m?.currency ?? 'AUD';
  openRecordForm({
    title: 'New quote',
    icon: 'tag',
    line: 'What it costs and how long it is good for. You are told before it lapses, and it can be compared with others for the same project.',
    ok: 'Add quote',
    fields: [
      { key: 'vendor', label: 'From', kind: 'vendor', options: vendors, required: true, value: prefill.vendor ?? '', hint: 'A new name becomes a vendor too.' },
      { key: 'project', label: 'For project', kind: 'choice', options: ['', ...projects], own: true, value: prefill.project ?? '' },
      { key: 'amount', label: 'Amount', kind: 'money' },
      { key: 'currency', label: 'Currency', kind: 'choice', options: [...new Set([cur, 'AUD', 'NZD', 'USD', 'EUR', 'GBP', 'SGD', 'AED'])], own: true, value: cur },
      { key: 'received', label: 'Received', kind: 'date', value: todayIso() },
      { key: 'valid', label: 'Valid until', kind: 'date', hint: 'Today and the bell say so before it lapses.' },
      { key: 'status', label: 'Where it stands', kind: 'segment', options: ['Received', 'Requested'] },
      { key: 'reference', label: 'Their reference', kind: 'text', placeholder: 'Q-1182' },
    ],
    submit: async (v) => {
      const r = await call<{ path: string; vendor: string | null }>('add-quote', { vendor: valueWords(v, 'vendor'), project: valueWords(v, 'project'), amount: valueNumber(v, 'amount'), currency: valueWords(v, 'currency') === cur ? '' : valueWords(v, 'currency'), received: valueWords(v, 'received') || null, validUntil: valueWords(v, 'valid') || null, status: valueWords(v, 'status'), reference: valueWords(v, 'reference') });
      void workDid(Promise.resolve(r), `Added the quote from ${valueWords(v, 'vendor')}${r.vendor ? `, and ${valueWords(v, 'vendor')} as a vendor` : ''}.`, { label: 'Open', run: () => openDetail('vendors', 'quote', r.path) });
    },
  });
}

function addOrder(m: View | null, from?: Quote, prefill: { vendor?: string } = {}): void {
  const vendors = m?.vendors.map((x) => x.name) ?? [];
  const projects = m?.projects.map((p) => p.name) ?? [];
  openRecordForm({
    title: from ? `Purchase order for ${from.vendor || from.name}` : 'New purchase order',
    icon: 'receipt',
    line: from ? 'Its vendor, project and amount come from the quote; change any before adding it.' : 'Follow it from raised to paid. Its delivery day comes to Overview if it passes.',
    ok: 'Add purchase order',
    fields: [
      { key: 'vendor', label: 'With', kind: 'vendor', options: vendors, required: true, value: from?.vendor ?? prefill.vendor ?? '' },
      { key: 'project', label: 'For project', kind: 'choice', options: ['', ...projects], own: true, value: from?.project ?? '' },
      { key: 'number', label: 'PO number', kind: 'text', placeholder: '4501' },
      { key: 'amount', label: 'Amount', kind: 'money', value: from?.amount !== null && from?.amount !== undefined ? String(from.amount) : '' },
      { key: 'raised', label: 'Raised', kind: 'date', value: todayIso() },
      { key: 'delivery', label: 'Delivery due', kind: 'date' },
      { key: 'status', label: 'Status', kind: 'choice', options: [...PO_STATUSES], value: 'Raised' },
    ],
    submit: async (v) => {
      const rel = await call<string>('add-order', { vendor: valueWords(v, 'vendor'), project: valueWords(v, 'project'), number: valueWords(v, 'number'), amount: valueNumber(v, 'amount'), raised: valueWords(v, 'raised') || null, delivery: valueWords(v, 'delivery') || null, status: valueWords(v, 'status'), ...(from ? { quotePath: from.path, quote: from.name } : {}) });
      void workDid(Promise.resolve(rel), `Added ${valueWords(v, 'number') ? `PO ${valueWords(v, 'number')}` : 'the purchase order'}.`, { label: 'Open', run: () => peek({ type: 'note', path: rel }, { title: 'Purchase order', type: 'note' }) });
    },
  });
}

function addContract(m: View | null, prefill: { vendor?: string } = {}): void {
  const vendors = m?.vendors.map((x) => x.name) ?? [];
  const projects = m?.projects.map((p) => p.name) ?? [];
  openRecordForm({
    title: 'New contract',
    icon: 'doc',
    line: 'Its value, when it runs and how much notice it needs. You are told before the day to give notice, and before it ends.',
    ok: 'Add contract',
    fields: [
      { key: 'vendor', label: 'With', kind: 'vendor', options: vendors, required: true, value: prefill.vendor ?? '' },
      { key: 'project', label: 'For project', kind: 'choice', options: ['', ...projects], own: true },
      { key: 'amount', label: 'Value', kind: 'money', hint: 'Each period (a year’s value for a yearly contract).' },
      { key: 'period', label: 'Charged', kind: 'choice', options: [...CONTRACT_PERIODS], value: 'Yearly' },
      { key: 'starts', label: 'Starts', kind: 'date' },
      { key: 'ends', label: 'Ends', kind: 'date' },
      { key: 'notice', label: 'Notice (days)', kind: 'number', placeholder: '30' },
      { key: 'renewal', label: 'At the end it', kind: 'choice', options: [...CONTRACT_RENEWALS], value: 'Ends' },
      { key: 'reference', label: 'Reference', kind: 'text', wide: true },
    ],
    submit: async (v) => {
      const rel = await call<string>('add-contract', { vendor: valueWords(v, 'vendor'), project: valueWords(v, 'project'), amount: valueNumber(v, 'amount'), period: valueWords(v, 'period'), starts: valueWords(v, 'starts') || null, ends: valueWords(v, 'ends') || null, noticeDays: valueNumber(v, 'notice'), renewal: valueWords(v, 'renewal'), reference: valueWords(v, 'reference') });
      void workDid(Promise.resolve(rel), `Added the contract with ${valueWords(v, 'vendor')}.`, { label: 'Open', run: () => openDetail('vendors', 'contract', rel) });
    },
  });
}

function extendQuote(q: Pick<Quote, 'path' | 'vendor' | 'validUntil'>): void {
  openRecordForm({
    title: `Extend ${q.vendor ? `${q.vendor}’s quote` : 'the quote'}`,
    icon: 'calendar',
    line: 'When the vendor holds their price for longer, give it the new day it is valid until.',
    ok: 'Save the new day',
    fields: [{ key: 'valid', label: 'Valid until', kind: 'date', required: true, value: q.validUntil ?? '' }],
    submit: async (v) => {
      const day = valueWords(v, 'valid');
      await call('set-field', { kind: 'quote', path: q.path, field: 'valid_until', value: day });
      // A quote marked lapsed by hand is back on the table once it has a new day. Both writes land together
      // (9.2 uplift F114): when reviving fails, the new day is backed out rather than left on a lapsed quote.
      let revived = false;
      try {
        await call('set-field', { kind: 'quote', path: q.path, field: 'status', value: 'Received' });
        revived = true;
      } catch {
        revived = false;
      }
      if (!revived) {
        await call('set-field', { kind: 'quote', path: q.path, field: 'valid_until', value: q.validUntil ?? '' }).catch(() => null);
        throw new Error('The new day wouldn’t save. Nothing was changed.');
      }
      void workDid(Promise.resolve(''), `Valid until ${dayText(day)}.`);
    },
  });
}

async function acceptQuote(q: Quote): Promise<void> {
  const r = await workDid(call<{ words: string; others: { path: string; vendor: string; name: string }[] }>('accept-quote', q.path), (x) => x.words);
  if (!r || !r.others.length) return;
  // The others for its project stay as they are unless the person says.
  const names = r.others.map((o) => o.vendor || o.name);
  window.setTimeout(
    () =>
      void workDid(Promise.resolve(''), `${say('other quote', r.others.length)} for ${q.project} ${r.others.length === 1 ? 'is' : 'are'} still open (${names.join(', ')}).`, {
        label: r.others.length === 1 ? 'Mark it declined' : 'Mark them declined',
        run: () => void workDid(call<string>('decline-quotes', r.others.map((o) => o.path))),
      }),
    400,
  );
}

async function keepFile(path: string, name: string): Promise<void> {
  const files = await call<string[]>('pick-files', `Choose files to keep with ${name}`).catch(() => [] as string[]);
  if (!files.length) return;
  await workDid(call<string[]>('keep-files', path, files), (added) => (added.length ? `Kept ${say('file', added.length)} with ${name}.` : 'Nothing was kept (the files were too big or not there).'));
}

function vendorOptions(remindDays: number, currency: string, save: (p: { remindDays?: number; settings?: Record<string, string | number | boolean> }) => Promise<void>): void {
  openRecordForm({
    title: `${packName('vendors', 'Suppliers')} options`,
    icon: 'settings',
    line: 'How far ahead Today and the bell say a quote lapses or a contract needs notice or ends, and the currency amounts are in.',
    ok: 'Save',
    fields: [
      { key: 'days', label: 'Days ahead', kind: 'number', value: String(remindDays), hint: 'A contract’s notice day, its end and a quote’s valid-until day show this many days before.' },
      { key: 'currency', label: 'Currency', kind: 'choice', options: [...new Set([currency, 'AUD', 'NZD', 'USD', 'EUR', 'GBP', 'SGD', 'AED'])], own: true, value: currency, hint: 'A quote in another currency keeps its own.' },
    ],
    submit: async (v) => {
      const cur = valueWords(v, 'currency').toUpperCase();
      if (cur && !/^[A-Z]{3}$/.test(cur)) throw new Error('A currency is three letters, like AUD or USD.');
      await save({ remindDays: valueNumber(v, 'days') ?? remindDays, settings: { currency: cur } });
    },
  });
}

// ── A value changed where it shows ───────────────────────────────────────────────────────────────────────────────────

type EditKind = 'text' | 'money' | 'date' | 'number' | 'choice';

/** One value on a record's own page: shown as words, changed in place (a click, then Enter, or a choice). */
function EditValue({ kind, value, shown, options, placeholder, canEdit, onSave, label }: { kind: EditKind; value: string; shown?: ReactNode; options?: readonly string[]; placeholder?: string; canEdit: boolean; onSave(v: string): Promise<boolean>; label: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const input = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);
  useEffect(() => {
    if (editing) input.current?.focus();
  }, [editing]);
  if (kind === 'choice')
    return (
      <span className="wv-select">
        <select aria-label={label} disabled={!canEdit} value={value} onChange={(e) => void onSave(e.target.value)}>
          {!options?.includes(value) && <option value={value}>{value || 'None'}</option>}
          {options?.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
        <Icon name="chevronDown" size={12} />
      </span>
    );
  if (!editing)
    return (
      <button type="button" className={`wv-value${value ? '' : ' is-empty'}`} disabled={!canEdit} title={canEdit ? `Change ${label.toLowerCase()}` : undefined} onClick={() => setEditing(true)}>
        <span>{value ? (shown ?? value) : placeholder ?? 'Add…'}</span>
        {canEdit && <Icon name="pencil" size={11} />}
      </button>
    );
  const done = async (keep: boolean) => {
    if (!keep || draft.trim() === value.trim()) return setEditing(false);
    if (await onSave(draft)) setEditing(false);
  };
  return (
    <input
      ref={input}
      className="wv-input"
      aria-label={label}
      type={kind === 'date' ? 'date' : 'text'}
      inputMode={kind === 'money' || kind === 'number' ? 'decimal' : undefined}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => void done(true)}
      onKeyDown={(e) => {
        if (isEnterKey(e)) void done(true);
        if (e.key === 'Escape') {
          e.stopPropagation();
          void done(false);
        }
      }}
    />
  );
}

interface FieldSpec {
  field: string;
  label: string;
  kind: EditKind;
  value: string;
  shown?: ReactNode;
  options?: readonly string[];
  placeholder?: string;
  hint?: ReactNode;
}

function Fields({ kind, path, fields, canEdit }: { kind: string; path: string; fields: FieldSpec[]; canEdit: boolean }) {
  return (
    <dl className="wv-fields">
      {fields.map((f) => (
        <div key={f.field} className="wv-field">
          <dt>{f.label}</dt>
          <dd>
            <EditValue kind={f.kind} value={f.value} shown={f.shown} options={f.options} placeholder={f.placeholder} canEdit={canEdit && !!path} label={f.label} onSave={(v) => setField(kind, path, f.field, v)} />
            {f.hint && <span className="wv-hint">{f.hint}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

// ── Rows ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

function Row({ icon, name, sub, end, onClick, menu, tone }: { icon: IconName; name: string; sub?: string; end?: ReactNode; onClick(): void; menu?: MenuItem[]; tone?: Tone }) {
  return (
    <li className={`rm-row wv-row${tone === 'bad' ? ' is-late' : ''}`}>
      <button type="button" className="rm-row-main" onClick={onClick}>
        <span className="rm-row-icon" aria-hidden="true">
          <Icon name={icon} size={14} />
        </span>
        <span className="rm-row-words">
          <span className="rm-row-name">{name}</span>
          {sub && <span className="rm-row-sub">{sub}</span>}
        </span>
      </button>
      {end && <span className="rm-row-end">{end}</span>}
      {menu && (
        <button type="button" className="icon-button small" aria-label={`More for ${name}`} onClick={(e) => openMenu(e.currentTarget, menu)}>
          <Icon name="more" size={13} />
        </button>
      )}
    </li>
  );
}

function QuoteRow({ q, today, showVendor = true }: { q: Quote; today: string; showVendor?: boolean }) {
  const sub = [showVendor ? q.vendor : '', q.project, q.validUntil ? (q.state === 'Lapsed' ? `lapsed ${dueWords(q.validUntil, today)}` : `valid until ${dueWords(q.validUntil, today)}`) : q.received ? `received ${dueWords(q.received, today)}` : ''].filter(Boolean).join(' · ');
  return (
    <Row
      icon="tag"
      name={showVendor ? q.name : q.project ? `${q.name}` : q.name}
      sub={sub}
      tone={q.state === 'Lapsed' && q.open === false && (q.status === 'Received' || q.status === 'Requested') ? 'bad' : undefined}
      onClick={() => openDetail('vendors', 'quote', q.path)}
      end={
        <>
          <span className="rm-row-amount">{cash(q.amount, q.currency)}</span>
          <Pill tone={quoteTone(q.state)}>{q.state}</Pill>
        </>
      }
    />
  );
}

// ── Overview ─────────────────────────────────────────────────────────────────────────────────────────────────────────

function ContractLine({ c, today, cur, byName }: { c: Contract; today: string; cur: string; byName?: boolean }) {
  const span = c.starts && c.ends ? Math.max(1, (new Date(c.ends).getTime() - new Date(c.starts).getTime()) / 86_400_000) : null;
  const gone = span && c.starts ? Math.min(1, Math.max(0, (new Date(today).getTime() - new Date(c.starts).getTime()) / 86_400_000 / span)) : null;
  const notice = span && c.starts && c.noticeBy ? Math.min(1, Math.max(0, (new Date(c.noticeBy).getTime() - new Date(c.starts).getTime()) / 86_400_000 / span)) : null;
  return (
    <li className="wv-cline">
      <button type="button" className="wv-cline-main" onClick={() => openDetail('vendors', 'contract', c.path)}>
        <span className="wv-cline-head">
          <span className="wv-cline-name">{byName ? c.name : c.vendor || c.name}</span>
          <Pill tone={contractTone(c.state)}>{c.state}</Pill>
        </span>
        <span className="wv-cline-track" aria-hidden="true">
          {gone !== null && <span className="wv-cline-fill" style={{ width: `${gone * 100}%` }} />}
          {notice !== null && <span className="wv-cline-notice" style={{ left: `${notice * 100}%` }} title="The day to give notice" />}
        </span>
        <span className="wv-cline-sub">
          {c.ends ? `${c.state === 'Ended' ? 'Ended' : 'Ends'} ${dueWords(c.ends, today)}${c.days !== null && c.days >= 0 ? ` · ${whenWords(c.days)}` : ''}` : 'No end day'}
          {c.noticeBy && c.state !== 'Ended' ? ` · notice by ${dueWords(c.noticeBy, today)}` : ''}
          {c.amount !== null ? ` · ${cash(c.amount, cur)} ${c.period === 'One-off' ? '' : c.period.toLowerCase()}` : ''}
        </span>
      </button>
    </li>
  );
}

const tintOf = (t: Tone): Tint => (t === 'ok' ? 'green' : t === 'warn' || t === 'next' ? 'amber' : t === 'bad' ? 'red' : 'slate');

/** Lapsing vs lapsed, never mixed (9.2 uplift F45): a quote marked lapsed by hand reads Lapsed, not "lapse soon". Lapsed
 *  is state alone (p15, Nov 2026): the model closes a lapsed quote, so gating on open hid every lapsed quote outright. */
const lapsesSoon = (q: Quote): boolean => q.open && q.state === 'Lapses soon';
const hasLapsed = (q: Quote): boolean => q.state === 'Lapsed';

function VendorTrow({ v, m }: { v: Vendor; m: View }) {
  const mine = <T extends { vendor: string; vendorPath: string | null }>(list: T[]) => list.filter((x) => sameRecord(v.path || null, v.name, x.vendorPath, x.vendor));
  const lapsing = mine(m.quotes).filter((q) => lapsesSoon(q) || hasLapsed(q)).sort((a, b) => Number(hasLapsed(a)) - Number(hasLapsed(b)) || (a.validUntil ?? '').localeCompare(b.validUntil ?? ''))[0];
  const orders = mine(m.orders).filter((o) => o.open);
  const live = mine(m.contracts)
    .filter((c) => c.state !== 'Ended' && c.state !== 'Draft')
    .sort((a, b) => (a.ends ?? '').localeCompare(b.ends ?? ''));
  const openVendor = () => openDetail('vendors', 'vendor', v.path || v.name);
  const menu = () => (v.path ? rowMenu(v.path, v.name, openVendor) : [{ label: `Open ${v.name}`, icon: 'briefcase' as const, run: openVendor }, { label: 'Add as a vendor', icon: 'plus' as const, run: () => addVendor({ name: v.name }) }]);
  return (
    <div className="trow" {...rowContext(menu)}>
      <button type="button" onClick={openVendor} className="t" title={v.name} style={{ border: 0, background: 'none', padding: 0, font: 'inherit', color: 'inherit', cursor: 'pointer', textAlign: 'left' }}>
        {v.name}
      </button>
      <span className="end">
        {lapsing ? (
          <>
            <span className="meta">{hasLapsed(lapsing) ? `quote lapsed${lapsing.validUntil ? ` ${shortDay(lapsing.validUntil)}` : ''}` : `quote lapses ${lapsing.validUntil ? shortDay(lapsing.validUntil) : 'soon'}`}{(lapsing.project || (v.category !== 'Other' ? v.category : '')) ? ` · ${lapsing.project || v.category!.toLowerCase()}` : ''} ·</span>
            <button type="button" className="tag red" style={{ border: 0, cursor: 'pointer', font: 'inherit' }} onClick={() => openDetail('vendors', 'quote', lapsing.path)} title={`Decide on ${v.name}’s quote`}>
              Decide
            </button>
          </>
        ) : orders.length ? (
          <>
            <span className="meta">{orders[0].number ? `PO-${orders[0].number}` : 'Order'} ordered{orders[0].project ? ` · ${orders[0].project}` : ''} ·</span>
            <span className="tag amber">{`${orders.length} open`}</span>
          </>
        ) : live.length ? (
          <>
            <span className="meta">{live[0].ends ? `contract to ${monthYear(live[0].ends!)}` : 'contract running'}{v.category && v.category !== 'Other' ? ` · ${v.category.toLowerCase()}` : ''} ·</span>
            <span className="tag green">Current</span>
          </>
        ) : (
          <span className="meta">{[v.category !== 'Other' ? v.category : null, v.status !== 'Active' ? v.status.toLowerCase() : null].filter(Boolean).join(' · ') || 'No open items'}</span>
        )}
      </span>
    </div>
  );
}

function Overview({ m, canEdit }: { m: View; canEdit: boolean }) {
  const on = useOn();
  const lapsing = m.quotes.filter(lapsesSoon);
  const lapsed = m.quotes.filter(hasLapsed);
  const openOrders = on.orders ? m.orders.filter((o) => o.open) : [];
  // The first project with two quotes to set beside each other, the lowest marked.
  const byProject = useMemo(() => {
    const out = new Map<string, Quote[]>();
    for (const q of m.quotes) if (q.project) out.set(q.project, [...(out.get(q.project) ?? []), q]);
    return [...out].filter(([, list]) => list.length >= 2).sort((a, b) => b[1].filter((q) => q.open).length - a[1].filter((q) => q.open).length || a[0].localeCompare(b[0]));
  }, [m.quotes]);
  const pool = byProject[0]?.[1] ?? [];
  const shown = (pool.filter((q) => q.open || q.state === 'Accepted').length >= 2 ? pool.filter((q) => q.open || q.state === 'Accepted') : pool).slice(0, 3);
  const compared = useMemo(() => (shown.length >= 2 ? compareQuotes(shown) : null), [shown]);
  return (
    <PackShell
      glyph="◇"
      tint="amber"
      title={packName('vendors', 'Suppliers')}
      sub="Vendors, quotes, orders and contracts, each tied to its project."
      facts={[
        {
          k: 'Needs you',
          v: (
            <>
              {lapsed.length ? <span className="pill red">{`${lapsed.length} lapsed`}</span> : null}
              {lapsing.length ? <span className="pill amber">{`${lapsing.length} lapse soon`}</span> : null}
              {openOrders.length ? <span className="pill amber">{`${plural(openOrders.length, 'order')} open`}</span> : null}
              {!lapsed.length && !lapsing.length && !openOrders.length ? <span className="pill green">Nothing needs you</span> : null}
            </>
          ),
        },
      ]}
      actions={
        <button type="button" className="btn pri" disabled={!canEdit} onClick={() => addQuote(m)}>
          + Add a quote
        </button>
      }
      menu={() => vendorsMenu(m, canEdit)}
    >
      {compared && byProject[0] && (
        <>
          <div className="glabel" style={{ margin: '18px 0 8px' }}>Compare quotes · {byProject[0][0]}</div>
          <div className="p87-cmp">
            {compared.quotes.map((q) => {
              const lapses = lapsesSoon(q);
              const fell = hasLapsed(q);
              return (
                <button key={q.path} type="button" onClick={() => openDetail('vendors', 'quote', q.path)} title={`Open ${q.vendor || q.name}’s quote`}>
                  <b>{q.vendor || q.name}</b>
                  <span>{cash(q.amount, q.currency)}</span>
                  <span>{q.validUntil ? `Valid to ${shortDay(q.validUntil)}` : 'No valid-until day'}</span>
                  {compared.cheapest === q.path ? <span className="tag green">Best price</span> : fell ? <span className="tag red">Lapsed</span> : lapses ? <span className="tag amber">Lapses soon</span> : <span className="tag slate">{q.state}</span>}
                </button>
              );
            })}
          </div>
        </>
      )}
      <PackSection label="Suppliers">
        {m.vendors.length ? (
          m.vendors.map((v) => <VendorTrow key={v.path || v.name} v={v} m={m} />)
        ) : (
          <p className="vsub">No vendors yet. A quote from someone new adds them too.</p>
        )}
      </PackSection>
    </PackShell>
  );
}

// ── Compare quotes ───────────────────────────────────────────────────────────────────────────────────────────────────

function Compare({ m, canEdit }: { m: View; canEdit: boolean }) {
  const byProject = useMemo(() => {
    const out = new Map<string, Quote[]>();
    for (const q of m.quotes) if (q.project) out.set(q.project, [...(out.get(q.project) ?? []), q]);
    return [...out].filter(([, list]) => list.length >= 2).sort((a, b) => b[1].filter((q) => q.open).length - a[1].filter((q) => q.open).length || a[0].localeCompare(b[0]));
  }, [m.quotes]);
  const [project, setProject] = useState<string>(() => byProject[0]?.[0] ?? '');
  const pool = project ? (byProject.find(([p]) => p === project)?.[1] ?? []) : m.quotes;
  const [picked, setPicked] = useState<Set<string> | null>(null);
  useEffect(() => setPicked(null), [project]);
  const chosen = picked ? pool.filter((q) => picked.has(q.path)) : pool.filter((q) => q.open || q.state === 'Accepted');
  const shown = chosen.length >= 2 ? chosen : pool.slice(0, Math.max(2, chosen.length));
  const c = useMemo(() => compareQuotes(shown), [shown]);
  const toggle = (path: string) => setPicked((s) => {
    const next = new Set(s ?? chosen.map((q) => q.path));
    if (next.has(path)) next.delete(path);
    else next.add(path);
    return next;
  });
  if (m.quotes.length < 2) return <EmptyState icon="table" title="Two quotes to compare" line="Once two vendors have quoted for the same thing, they show here side by side, item by item, the lowest marked." action={{ label: 'Add a quote', icon: 'plus', run: () => addQuote(m), disabled: !canEdit }} size="panel" />;
  return (
    <div className="wv-compare">
      <div className="wv-compare-bar">
        <label className="wv-compare-pick">
          <span>Quotes for</span>
          <span className="wv-select">
            <select value={project} onChange={(e) => setProject(e.target.value)} aria-label="Which project’s quotes">
              {byProject.map(([p, list]) => (
                <option key={p} value={p}>
                  {p} ({list.length})
                </option>
              ))}
              <option value="">Any quotes I tick</option>
            </select>
            <Icon name="chevronDown" size={12} />
          </span>
        </label>
        <div className="wv-compare-chips" role="group" aria-label="Quotes compared">
          {pool.map((q) => (
            <label key={q.path} className={`wv-chip${shown.includes(q) ? ' is-on' : ''}`}>
              <input type="checkbox" checked={shown.includes(q)} onChange={() => toggle(q.path)} />
              {project ? q.vendor || q.name : `${q.vendor || q.name}${q.project ? ` · ${q.project}` : ''}`}
            </label>
          ))}
        </div>
      </div>
      {shown.length < 2 ? (
        <p className="rm-none">Tick two or more quotes to see them side by side.</p>
      ) : (
        <div className="wv-compare-scroll">
          <table className="wv-compare-table">
            <thead>
              <tr>
                <th scope="col" className="wv-ct-label" />
                {c.quotes.map((q) => (
                  <th key={q.path} scope="col" className={c.cheapest === q.path ? 'is-best' : ''}>
                    <button type="button" className="wv-ct-vendor" onClick={() => openDetail('vendors', 'quote', q.path)}>
                      {q.vendor || q.name}
                    </button>
                    {c.cheapest === q.path && <span className="wv-best">Lowest</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="wv-ct-amount">
                <th scope="row">Amount</th>
                {c.quotes.map((q) => (
                  <td key={q.path} className={c.cheapest === q.path ? 'is-best' : ''}>
                    <strong>{cash(q.amount, q.currency)}</strong>
                    {c.over[q.path] ? <span className="wv-over">+{cash(c.over[q.path], q.currency)}</span> : null}
                  </td>
                ))}
              </tr>
              <tr>
                <th scope="row">Valid until</th>
                {c.quotes.map((q) => (
                  <td key={q.path}>{q.validUntil ? dayText(q.validUntil) : ''}</td>
                ))}
              </tr>
              <tr>
                <th scope="row">Where it stands</th>
                {c.quotes.map((q) => (
                  <td key={q.path}>
                    <Pill tone={quoteTone(q.state)}>{q.state}</Pill>
                  </td>
                ))}
              </tr>
              <tr>
                <th scope="row">Reference</th>
                {c.quotes.map((q) => (
                  <td key={q.path}>{[q.reference, q.version].filter(Boolean).join(' · ') || ''}</td>
                ))}
              </tr>
              {c.rows.length > 0 && (
                <tr className="wv-ct-sep">
                  <th scope="row" colSpan={c.quotes.length + 1}>
                    Items
                  </th>
                </tr>
              )}
              {c.rows.map((r, i) => {
                const totals = r.cells.map((x) => x?.total ?? null);
                const low = totals.filter((x): x is number => x !== null);
                const min = low.length >= 2 ? Math.min(...low) : null;
                return (
                  <tr key={i} className="wv-ct-item">
                    <th scope="row">{r.item}</th>
                    {r.cells.map((cell, j) => (
                      <td key={j} className={cell && min !== null && cell.total === min ? 'is-low' : ''}>
                        {cell ? (
                          <>
                            {cash(cell.total, c.quotes[j].currency)}
                            {cell.qty !== null && cell.unit !== null && <span className="wv-ct-qty">{`${cell.qty} × ${cash(cell.unit, c.quotes[j].currency)}`}</span>}
                          </>
                        ) : (
                          <span className="wv-ct-none">Not listed</span>
                        )}
                      </td>
                    ))}
                  </tr>
                );
              })}
              <tr className="wv-ct-actions">
                <th scope="row" />
                {c.quotes.map((q) => (
                  <td key={q.path}>
                    {q.state === 'Accepted' ? (
                      <Pill tone="ok">Accepted</Pill>
                    ) : (
                      <button type="button" className="button small" disabled={!canEdit} onClick={() => void acceptQuote(q)}>
                        <Icon name="check" size={12} /> Accept this one
                      </button>
                    )}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── A vendor's, a quote's and a contract's own pages ─────────────────────────────────────────────────────────────────

function Files({ files, path, name, canEdit }: { files: string[]; path: string; name: string; canEdit: boolean }) {
  return (
    <Card
      id="vfiles"
      title="Files"
      count={files.length}
      actions={
        <button type="button" className="text-button" disabled={!canEdit} onClick={() => void keepFile(path, name)}>
          <Icon name="paperclip" size={12} /> Keep a file
        </button>
      }
    >
      {files.length ? (
        <ul className="rm-rows">
          {files.map((f) => (
            <Row key={f} icon="file" name={f.split('/').pop()!} onClick={() => A.openPath(f, { where: 'tab' })} />
          ))}
        </ul>
      ) : (
        <p className="rm-none">Keep the signed copy, the PDF the vendor sent or anything else with it.</p>
      )}
    </Card>
  );
}

function VendorDetail({ v, m, canEdit }: { v: Vendor; m: View; canEdit: boolean }) {
  const on = useOn();
  const mine = <T extends { vendor: string; vendorPath: string | null }>(list: T[]) => list.filter((x) => sameRecord(v.path || null, v.name, x.vendorPath, x.vendor));
  const quotes = mine(m.quotes);
  const orders = mine(m.orders);
  const contracts = mine(m.contracts);
  const cur = m.currency;
  return (
    <div className="rm-overview wv-detail">
      {!v.path && (
        <div className="wv-banner tone-warn">
          <Icon name="info" size={14} />
          <span>{v.name} is named on a quote, order or contract but has no vendor note of its own yet.</span>
          <button type="button" className="button small" disabled={!canEdit} onClick={() => addVendor({ name: v.name })}>
            Add as a vendor
          </button>
        </div>
      )}
      <div className="rm-tiles">
        <Tile icon="tag" label="Open quotes" value={v.openValueWords} sub={say('open quote', v.openQuotes)} />
        <Tile icon="check" label="Accepted" value={v.acceptedValueWords} sub={`${say('quote', v.quotes)} in all`} />
        {on.orders && <Tile icon="receipt" label="Ordered" value={cash(v.ordersValue, cur)} sub={`${say('order', v.orders)}, ${v.openOrders} open`} />}
        {on.contracts && <Tile icon="doc" label="Contracts" value={String(v.activeContracts)} sub={v.contracts ? `${v.contracts} in all` : 'None yet'} />}
      </div>
      <div className="rm-cols wv-cols">
        <Card id="vdetails" title="Details">
          <Fields
            kind="vendor"
            path={v.path}
            canEdit={canEdit}
            fields={[
              { field: 'category', label: 'Supplies', kind: 'choice', value: v.category, options: VENDOR_CATEGORIES },
              { field: 'status', label: 'Status', kind: 'choice', value: v.status, options: VENDOR_STATUSES },
              { field: 'contact', label: 'Contact', kind: 'text', value: v.contact, placeholder: 'Who you deal with' },
              { field: 'email', label: 'Email', kind: 'text', value: v.email, shown: v.email ? <a href={`mailto:${v.email}`} onClick={(e) => e.stopPropagation()}>{v.email}</a> : undefined },
              { field: 'phone', label: 'Phone', kind: 'text', value: v.phone },
              { field: 'website', label: 'Website', kind: 'text', value: v.website },
            ]}
          />
        </Card>
        <Card id="vquotes" title="Quotes" count={quotes.length} actions={<button type="button" className="text-button" disabled={!canEdit} onClick={() => addQuote(m, { vendor: v.name })}><Icon name="plus" size={12} /> New quote</button>}>
          {quotes.length ? (
            <ul className="rm-rows">
              {quotes.map((q) => (
                <QuoteRow key={q.path} q={q} today={m.today} showVendor={false} />
              ))}
            </ul>
          ) : (
            <p className="rm-none">No quotes from {v.name} yet.</p>
          )}
        </Card>
      </div>
      <div className="rm-cols wv-cols">
        {on.orders && (
          <Card id="vorders" title="Purchase orders" count={orders.length} actions={<button type="button" className="text-button" disabled={!canEdit} onClick={() => addOrder(m, undefined, { vendor: v.name })}><Icon name="plus" size={12} /> New order</button>}>
            {orders.length ? (
              <ul className="rm-rows">
                {orders.map((o) => (
                  <Row key={o.path} icon="receipt" name={o.number ? `PO ${o.number}` : o.name} sub={[o.project, o.raised ? `raised ${dueWords(o.raised, m.today)}` : ''].filter(Boolean).join(' · ')} tone={o.late ? 'bad' : undefined} onClick={() => openDetail('vendors', 'order', o.path)} end={<><span className="rm-row-amount">{cash(o.amount, cur)}</span><Pill tone={orderTone(o)}>{o.late ? 'Late' : o.status}</Pill></>} />
                ))}
              </ul>
            ) : (
              <p className="rm-none">No orders with {v.name} yet.</p>
            )}
          </Card>
        )}
        {on.contracts && (
          <Card id="vvcontracts" title="Contracts" count={contracts.length} actions={<button type="button" className="text-button" disabled={!canEdit} onClick={() => addContract(m, { vendor: v.name })}><Icon name="plus" size={12} /> New contract</button>}>
            {contracts.length ? (
              <ul className="wv-clines">
                {contracts.map((c) => (
                  <ContractLine key={c.path} c={c} today={m.today} cur={cur} byName />
                ))}
              </ul>
            ) : (
              <p className="rm-none">No contracts with {v.name}.</p>
            )}
          </Card>
        )}
      </div>
      {v.path && <Files files={v.files} path={v.path} name={v.name} canEdit={canEdit} />}
    </div>
  );
}

function ItemCell({ q, row, part, value, canEdit, money }: { q: Quote; row: number; part: 'item' | 'qty' | 'unit' | 'total'; value: string; canEdit: boolean; money?: boolean }) {
  return <EditValue kind={part === 'item' ? 'text' : 'number'} value={value} shown={money && value ? cash(Number(value), q.currency) : undefined} canEdit={canEdit} label={part === 'item' ? 'Item' : part === 'qty' ? 'Quantity' : part === 'unit' ? 'Unit price' : 'Total'} onSave={(v) => workDid(call<string | null>('set-item', q.path, row, part, v)).then((r) => r !== null)} />;
}

function NewItem({ q, canEdit }: { q: Quote; canEdit: boolean }) {
  const [item, setItem] = useState('');
  const [qty, setQty] = useState('');
  const [unit, setUnit] = useState('');
  const add = async () => {
    if (!item.trim()) return;
    const r = await workDid(call<string | null>('add-item', q.path, { item, qty, unit }), (said) => said ?? `Added ${item.trim()}.`);
    if (r !== null) {
      setItem('');
      setQty('');
      setUnit('');
    }
  };
  if (!canEdit) return null;
  const key = (e: React.KeyboardEvent) => e.key === 'Enter' && void add();
  return (
    <tr className="wv-items-new">
      <td>
        <input className="wv-input" placeholder="Add an item…" aria-label="New item" value={item} onChange={(e) => setItem(e.target.value)} onKeyDown={key} />
      </td>
      <td>
        <input className="wv-input" placeholder="Qty" aria-label="New item’s quantity" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} onKeyDown={key} />
      </td>
      <td>
        <input className="wv-input" placeholder="Unit price" aria-label="New item’s unit price" inputMode="decimal" value={unit} onChange={(e) => setUnit(e.target.value)} onKeyDown={key} />
      </td>
      <td className="wv-num">{qty && unit && Number.isFinite(Number(qty) * Number(unit.replace(/[$,]/g, ''))) ? cash(Number(qty) * Number(unit.replace(/[$,]/g, '')), q.currency) : ''}</td>
      <td>
        <button type="button" className="button small" disabled={!item.trim()} onClick={() => void add()}>
          Add
        </button>
      </td>
    </tr>
  );
}

function QuoteDetail({ q, m, canEdit }: { q: Quote; m: View; canEdit: boolean }) {
  const on = useOn();
  const others = q.project ? m.quotes.filter((x) => x.project === q.project && x.path !== q.path) : [];
  const differs = q.itemsTotal !== null && q.amount !== null && Math.abs(q.itemsTotal - q.amount) >= 0.01;
  const orders = m.orders.filter((o) => o.quotePath === q.path);
  return (
    <div className="rm-overview wv-detail">
      {(q.state === 'Lapsed' || q.state === 'Lapses soon') && (
        <div className={`wv-banner tone-${q.state === 'Lapsed' ? 'bad' : 'warn'}`}>
          <Icon name="clock" size={14} />
          <span>{q.state === 'Lapsed' ? `This quote lapsed${q.validUntil ? ` on ${dueWords(q.validUntil, m.today)}` : ''}. Ask ${q.vendor || 'the vendor'} to hold the price, then give it its new day.` : `This quote lapses ${whenWords(q.days ?? 0)}${q.validUntil ? ` (${dueWords(q.validUntil, m.today)})` : ''}.`}</span>
          <button type="button" className="button small" disabled={!canEdit} onClick={() => extendQuote(q)}>
            Extend
          </button>
        </div>
      )}
      <div className="rm-cols wv-cols">
        <Card id="qdetails" title="Details">
          <Fields
            kind="quote"
            path={q.path}
            canEdit={canEdit}
            fields={[
              { field: 'vendor', label: 'From', kind: 'choice', value: q.vendor, options: m.vendors.map((v) => v.name) },
              { field: 'project', label: 'For project', kind: 'choice', value: q.project, options: ['', ...m.projects.map((p) => p.name)] },
              { field: 'amount', label: 'Amount', kind: 'money', value: q.amount !== null ? String(q.amount) : '', shown: cash(q.amount, q.currency), hint: differs ? <>Items add up to {cash(q.itemsTotal!, q.currency)}. <button type="button" className="text-button" disabled={!canEdit} onClick={() => void setField('quote', q.path, 'amount', q.itemsTotal)}>Use that</button></> : undefined },
              { field: 'received', label: 'Received', kind: 'date', value: q.received ?? '', shown: dayText(q.received) },
              { field: 'valid_until', label: 'Valid until', kind: 'date', value: q.validUntil ?? '', shown: q.validUntil ? `${dayText(q.validUntil)}${q.days !== null && q.state !== 'Accepted' && q.state !== 'Declined' ? ` · ${q.days < 0 ? `${plural(-q.days, 'day')} ago` : whenWords(q.days)}` : ''}` : undefined },
              { field: 'status', label: 'Status', kind: 'choice', value: q.status, options: QUOTE_STATUSES },
              { field: 'reference', label: 'Their reference', kind: 'text', value: q.reference },
              { field: 'version', label: 'Version', kind: 'text', value: q.version, placeholder: 'v2' },
            ]}
          />
        </Card>
        <Card id="qnext" title="What next">
          <div className="wv-actions">
            {q.state !== 'Accepted' && (
              <button type="button" className="button primary small" disabled={!canEdit} onClick={() => void acceptQuote(q)}>
                <Icon name="check" size={12} /> Accept this quote
              </button>
            )}
            {on.orders && (
              <button type="button" className="button small" disabled={!canEdit} onClick={() => addOrder(m, q)}>
                <Icon name="receipt" size={12} /> Make a purchase order
              </button>
            )}
            {others.length > 0 && (
              <button type="button" className="button small" onClick={() => openModule('vendors', 'compare')}>
                <Icon name="table" size={12} /> Compare with {say('other quote', others.length)}
              </button>
            )}
            <button type="button" className="button small" onClick={() => A.openPath(q.path, { where: 'tab' })}>
              <Icon name="notes" size={12} /> Open its note
            </button>
          </div>
          {others.length > 0 && (
            <ul className="rm-rows wv-others">
              {others.map((o) => (
                <QuoteRow key={o.path} q={o} today={m.today} />
              ))}
            </ul>
          )}
          {orders.length > 0 && <p className="wv-note">{orders.map((o) => (o.number ? `PO ${o.number}` : o.name)).join(', ')} raised from this quote.</p>}
        </Card>
      </div>
      <Card id="qitems" title="Items" count={q.items.length}>
        {q.items.length || canEdit ? (
          <div className="wv-items-scroll">
            <table className="wv-items">
              <thead>
                <tr>
                  <th scope="col">Item</th>
                  <th scope="col" className="wv-num">
                    Qty
                  </th>
                  <th scope="col" className="wv-num">
                    Unit price
                  </th>
                  <th scope="col" className="wv-num">
                    Total
                  </th>
                  <th scope="col" aria-label="Take off" />
                </tr>
              </thead>
              <tbody>
                {q.items.map((it) => (
                  <tr key={it.row}>
                    <td>
                      <ItemCell q={q} row={it.row} part="item" value={it.item} canEdit={canEdit} />
                    </td>
                    <td className="wv-num">
                      <ItemCell q={q} row={it.row} part="qty" value={it.qty !== null ? String(it.qty) : ''} canEdit={canEdit && q.cols.qty >= 0} />
                    </td>
                    <td className="wv-num">
                      <ItemCell q={q} row={it.row} part="unit" value={it.unit !== null ? String(it.unit) : ''} canEdit={canEdit && q.cols.unit >= 0} money />
                    </td>
                    <td className="wv-num">
                      <ItemCell q={q} row={it.row} part="total" value={it.total !== null ? String(it.total) : ''} canEdit={canEdit && q.cols.total >= 0} money />
                    </td>
                    <td>
                      {canEdit && (
                        <button type="button" className="icon-button small" aria-label={takeOffAria(it.item)} title={takeOffAria(it.item)} onClick={() => void workDid(call<string | null>('remove-item', q.path, it.row), (said) => said ?? takeOffSaid(it.item))}>
                          <Icon name="close" size={12} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                <NewItem q={q} canEdit={canEdit} />
              </tbody>
              {q.itemsTotal !== null && (
                <tfoot>
                  <tr>
                    <th scope="row" colSpan={3}>
                      Items total
                    </th>
                    <td className="wv-num">
                      <strong>{cash(q.itemsTotal, q.currency)}</strong>
                    </td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        ) : (
          <p className="rm-none">No items listed.</p>
        )}
      </Card>
      <Files files={q.files} path={q.path} name={q.name} canEdit={canEdit} />
    </div>
  );
}

/** Raised to paid, one map (9.2 uplift F44): the label and the highlight come from the same row, so a
 *  raised order highlights Raised. Approved reads as Ordered (placed with the vendor, awaiting delivery);
 *  Invoiced reads as Delivered, awaiting payment. -1: not on the line (a draft, cancelled, or unknown). */
const ORDER_STAGES: { label: string; at(status: string): boolean }[] = [
  { label: 'Raised', at: (s) => s === 'Raised' },
  { label: 'Ordered', at: (s) => s === 'Approved' },
  { label: 'Delivered', at: (s) => s === 'Delivered' || s === 'Invoiced' },
  { label: 'Paid', at: (s) => s === 'Paid' },
];
function orderStage(status: string): number {
  return ORDER_STAGES.findIndex((st) => st.at(status));
}

/** An order's stage in plain words: Approved reads Ordered (placed with the vendor, awaiting delivery). */
function orderStageWords(status: string): string {
  return status === 'Approved' ? 'Ordered' : status;
}

function orderStageTint(status: string): Tint {
  return status === 'Paid' || status === 'Delivered' || status === 'Invoiced' ? 'green' : status === 'Draft' || status === 'Cancelled' ? 'slate' : 'amber';
}

function OrderDetail({ o, m, canEdit }: { o: PurchaseOrder; m: View; canEdit: boolean }) {
  const cur = m.currency;
  const quote = o.quotePath ? m.quotes.find((q) => q.path === o.quotePath) : undefined;
  const stage = orderStage(o.status);
  const stages = ORDER_STAGES.map((st) => st.label);
  const deliveryWords = o.late && o.delivery ? lateWords(o.delivery, m.today) : o.status === 'Paid' ? 'Paid' : o.status === 'Delivered' ? 'Delivered' : o.delivery ? `Arrives ${o.delivery <= daysAhead(m.today, 7) ? weekdayLong(o.delivery) : shortDay(o.delivery)}` : null;
  const nextAction = o.open && o.status !== 'Delivered' && o.status !== 'Paid' ? { label: 'Mark delivered', status: 'Delivered' } : o.status === 'Delivered' ? { label: 'Mark paid', status: 'Paid' } : null;
  return (
    <PackShell
      glyph="◇"
      tint={o.late ? 'red' : tintOf(orderTone(o))}
      title={o.number ? `PO-${o.number} · ${o.project || o.vendor || o.name}` : o.name}
      sub={[o.vendor, o.project && `For ${o.project}`, deliveryWords].filter(Boolean).join('. ') + '.'}
      facts={[
        { k: 'Status', v: <span className={`pill ${o.late ? 'red' : orderStageTint(o.status)}`}>{o.late ? 'Late' : orderStageWords(o.status)}</span> },
        { k: 'Amount', v: `${cash(o.amount, cur)}${o.quote ? ` · raised from ${o.quote}` : ''}` },
        ...(o.project ? [{ k: 'Project', v: o.project }] : []),
      ]}
      actions={nextAction ? <button type="button" className="btn pri" disabled={!canEdit} onClick={() => void setField('order', o.path, 'status', nextAction.status)}>{nextAction.label}</button> : undefined}
      sharePath={o.path}
      menu={() => [
        { label: packName('vendors', 'Suppliers'), icon: 'briefcase', run: () => openModule('vendors', 'overview') },
        { label: 'Purchase orders', icon: 'receipt', run: () => openModule('vendors', 'orders') },
        { separator: true },
        ...(quote ? [{ label: 'The quote it came from', icon: 'tag' as const, run: () => openDetail('vendors', 'quote', quote.path) }] : []),
        { label: 'Open its note', icon: 'notes', run: () => A.openPath(o.path, { where: 'tab' }) },
        { separator: true },
        { label: 'Delete', icon: 'trash', danger: true, disabled: !canEdit, run: () => void A.trashPath(o.path).catch(showError) },
      ]}
    >
      {o.late && (
        <div className="callout amber" style={{ marginTop: 14 }}>
          <span aria-hidden="true">◷</span>
          <span>
            Its delivery day has passed and it is not marked delivered yet.{' '}
            <button type="button" className="btn quiet" style={{ height: 26 }} disabled={!canEdit} onClick={() => void setField('order', o.path, 'status', 'Delivered')}>
              Mark delivered
            </button>
          </span>
        </div>
      )}
      <PackSection label="Raised to paid" pad>
        <div className="p87-tl" role="img" aria-label={`Order status: ${o.status}`}>
          {stages.map((s, i) => (
            <Fragment key={s}>
              {i > 0 && <em />}
              <div className={`st${stage >= 0 && i < stage ? ' done' : ''}${stage === i ? ' now' : ''}`}>
                <i />
                <b>{s}</b>
              </div>
            </Fragment>
          ))}
        </div>
        {(o.status === 'Draft' || o.status === 'Cancelled') && <p className="vsub" style={{ marginTop: 8 }}>{o.status === 'Draft' ? 'Still a draft: raise it to start the line.' : 'Cancelled: off the line.'}</p>}
      </PackSection>
      {quote && quote.items.length > 0 && (
        <PackSection label="Items">
          {quote.items.map((it) => (
            <div key={it.row} className="trow">
              <span className="t">{it.item}{it.qty !== null ? ` × ${it.qty}` : ''}</span>
              <span className="end">
                <span className="meta">{it.total !== null ? cash(it.total, quote.currency) : it.unit !== null ? cash(it.unit, quote.currency) : ''}</span>
              </span>
            </div>
          ))}
        </PackSection>
      )}
      <PackSection label="Details" pad>
        <Fields
          kind="order"
          path={o.path}
          canEdit={canEdit}
          fields={[
            { field: 'vendor', label: 'With', kind: 'choice', value: o.vendor, options: m.vendors.map((v) => v.name) },
            { field: 'project', label: 'For project', kind: 'choice', value: o.project, options: ['', ...m.projects.map((p) => p.name)] },
            { field: 'po_number', label: 'Order number', kind: 'text', value: o.number },
            { field: 'amount', label: 'Amount', kind: 'money', value: o.amount !== null ? String(o.amount) : '', shown: cash(o.amount, cur) },
            { field: 'raised', label: 'Raised', kind: 'date', value: o.raised ?? '', shown: dayText(o.raised) },
            { field: 'delivery', label: 'Delivery due', kind: 'date', value: o.delivery ?? '', shown: dayText(o.delivery) },
            { field: 'status', label: 'Status', kind: 'choice', value: o.status, options: PO_STATUSES },
          ]}
        />
      </PackSection>
      <PackSection label="Files">
        {o.files.length ? (
          o.files.map((f) => (
            <div key={f} className="trow">
              <span className="t">{f.split('/').pop()}</span>
              <span className="end">
                <button type="button" className="btn quiet" style={{ height: 26 }} onClick={() => A.openPath(f, { where: 'tab' })}>
                  Open
                </button>
              </span>
            </div>
          ))
        ) : (
          <p className="vsub">
            No files kept with it yet.{' '}
            <button type="button" className="btn quiet" style={{ height: 26 }} disabled={!canEdit} onClick={() => void keepFile(o.path, o.name)}>
              Keep a file
            </button>
          </p>
        )}
      </PackSection>
      <AskFloat question={(w) => `About purchase order ${o.number ? `PO-${o.number}` : o.name} with ${o.vendor}: ${w}`} />
    </PackShell>
  );
}

/** An ISO day n days after today. */
function daysAhead(today: string, n: number): string {
  const d = new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10)));
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function ContractDetail({ c, m, canEdit }: { c: Contract; m: View; canEdit: boolean }) {
  const cur = m.currency;
  return (
    <div className="rm-overview wv-detail">
      {(c.state === 'Notice period soon' || c.state === 'In notice period' || c.state === 'Ending') && (
        <div className="wv-banner tone-warn">
          <Icon name="clock" size={14} />
          <span>
            {c.state === 'Notice period soon' && c.noticeBy ? `Give notice by ${dueWords(c.noticeBy, m.today)} if it shouldn’t ${c.renewal === 'Auto-renews' ? 'renew by itself' : 'run on'}.` : c.state === 'In notice period' ? (c.renewal === 'Auto-renews' && c.ends ? `It renews on ${dueWords(c.ends, m.today)}; too late to give notice.` : `The day to give notice${c.noticeBy ? ` (${dueWords(c.noticeBy, m.today)})` : ''} has passed.`) : c.ends ? `It ends ${whenWords(c.days ?? 0)} (${dueWords(c.ends, m.today)}).` : ''}
          </span>
        </div>
      )}
      <ul className="wv-clines wv-cline-big">
        <ContractLine c={c} today={m.today} cur={cur} />
      </ul>
      <div className="rm-cols wv-cols">
        <Card id="cdetails" title="Details">
          <Fields
            kind="contract"
            path={c.path}
            canEdit={canEdit}
            fields={[
              { field: 'vendor', label: 'With', kind: 'choice', value: c.vendor, options: m.vendors.map((v) => v.name) },
              { field: 'project', label: 'For project', kind: 'choice', value: c.project, options: ['', ...m.projects.map((p) => p.name)] },
              { field: 'amount', label: 'Value', kind: 'money', value: c.amount !== null ? String(c.amount) : '', shown: cash(c.amount, cur) },
              { field: 'period', label: 'Charged', kind: 'choice', value: c.period, options: CONTRACT_PERIODS },
              { field: 'starts', label: 'Starts', kind: 'date', value: c.starts ?? '', shown: dayText(c.starts) },
              { field: 'ends', label: 'Ends', kind: 'date', value: c.endsWritten ?? '', shown: dayText(c.endsWritten), hint: c.rolled && c.ends ? `Renewed by itself: now runs to ${dayText(c.ends)}.` : undefined },
              { field: 'notice_by', label: 'Give notice by', kind: 'date', value: c.noticeBy ?? '', shown: c.noticeBy ? `${dayText(c.noticeBy)}${c.noticeDays ? ` · ${plural(c.noticeDays, 'day')} before it ends` : ''}` : undefined, placeholder: 'No notice needed' },
              { field: 'renewal', label: 'At the end it', kind: 'choice', value: c.renewal, options: CONTRACT_RENEWALS },
              { field: 'status', label: 'Status', kind: 'choice', value: c.status, options: CONTRACT_STATUSES },
              { field: 'reference', label: 'Reference', kind: 'text', value: c.reference },
            ]}
          />
        </Card>
        <Files files={c.files} path={c.path} name={c.name} canEdit={canEdit} />
      </div>
    </div>
  );
}

// ── The page ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Every Vendors page and action in the one menu, so nothing is more than a tap away. */
function vendorsMenu(m: View | null, canEdit: boolean, save?: (p: { remindDays?: number; settings?: Record<string, string | number | boolean> }) => Promise<void>): MenuItem[] {
  if (!m) return [];
  const name = packName('vendors', 'Suppliers');
  return [
    { label: name, icon: 'briefcase', run: () => openModule('vendors', 'overview') },
    { label: 'Vendors', icon: 'briefcase', run: () => openModule('vendors', 'vendors') },
    { label: 'Quotes', icon: 'tag', run: () => openModule('vendors', 'quotes') },
    { label: 'Compare quotes', icon: 'table', run: () => openModule('vendors', 'compare') },
    { label: 'Purchase orders', icon: 'receipt', run: () => openModule('vendors', 'orders') },
    { label: 'Contracts', icon: 'doc', run: () => openModule('vendors', 'contracts') },
    { separator: true },
    { label: 'New vendor', icon: 'briefcase', disabled: !canEdit, run: () => addVendor() },
    { label: 'New quote', icon: 'tag', disabled: !canEdit, run: () => addQuote(m) },
    { label: 'New purchase order', icon: 'receipt', disabled: !canEdit, run: () => addOrder(m) },
    { label: 'New contract', icon: 'doc', disabled: !canEdit, run: () => addContract(m) },
    { separator: true },
    { label: `${name} options…`, icon: 'settings', disabled: !canEdit || !save, run: () => save && vendorOptions(m.remindDays, m.currency, save) },
    { label: 'Show the folder', icon: 'folder', run: () => A.revealInExplorer(m.folder) },
    { separator: true },
    { label: `Show me around ${name}`, icon: 'help', run: () => openTour('vendors') },
  ];
}

/** One of the pack's inner pages around its kept content. */
function VendorsSection({ m, canEdit, label, line, add, save, children }: { m: View; canEdit: boolean; label: string; line: string; add: { label: string; run(): void }; save: (p: { remindDays?: number; settings?: Record<string, string | number | boolean> }) => Promise<void>; children: ReactNode }) {
  return (
    <PackShell
      glyph="◇"
      tint="amber"
      title={label}
      sub={line}
      actions={
        <button type="button" className="btn pri" disabled={!canEdit} onClick={add.run}>
          + {add.label}
        </button>
      }
      menu={() => vendorsMenu(m, canEdit, save)}
    >
      {children}
    </PackShell>
  );
}

/** A vendor's, quote's or contract's own page around its kept content, with its note and Delete in the menu. */
function VendorDetailShell({ title, line, path, canEdit, children }: { title: string; line: string; path: string | null; canEdit: boolean; children: ReactNode }) {
  return (
    <PackShell
      glyph="◇"
      tint="amber"
      title={title}
      sub={line}
      sharePath={path ?? undefined}
      menu={() => [
        { label: packName('vendors', 'Suppliers'), icon: 'briefcase', run: () => openModule('vendors', 'overview') },
        ...(path
          ? ([
              { separator: true },
              { label: 'Open its note', icon: 'notes', run: () => A.openPath(path, { where: 'tab' }) },
              { separator: true },
              { label: 'Delete', icon: 'trash', danger: true, disabled: !canEdit, run: () => void A.trashPath(path).catch(showError) },
            ] as MenuItem[])
          : []),
      ]}
    >
      {children}
    </PackShell>
  );
}

export function VendorsPage({ tab }: { tab: W.TabState }) {
  const canEdit = useApp((s) => s.canEdit);
  const on = useOn();
  const { data: m, error } = useWork<View>('vendors');
  const { save } = useWorkOptions('vendors');
  if (m) setRecordCurrency(m.currency);
  const sections = VENDORS.sections.filter((s) => (s.id !== 'orders' || on.orders) && (s.id !== 'contracts' || on.contracts));
  const { section, detail } = placeOf(tab, VENDORS, sections);
  const records = useMemo(() => (m ? vendorRecords(m).filter((r) => (r.kind !== 'order' || on.orders) && (r.kind !== 'contract' || on.contracts)) : []), [m, on.orders, on.contracts]);
  const ctx = useWorkCtx('vendors', records, {
    editable: (r) => (r.kind === 'vendor' && !r.path ? [] : (VENDOR_EDITABLE[r.kind] ?? [])),
    open: (r, e) => {
      if (e?.ctrlKey || e?.metaKey) return r.path && A.openPath(r.path, { where: 'tab' });
      if (r.kind === 'vendor') return openDetail('vendors', 'vendor', r.path || r.title);
      if ((r.kind === 'quote' || r.kind === 'contract' || r.kind === 'order') && r.path) return openDetail('vendors', r.kind, r.path);
      if (r.path) peek({ type: 'note', path: r.path }, { title: r.title, type: 'note' });
    },
  });
  const info = sections.find((s) => s.id === section) ?? VENDORS.sections[0];
  const add = section === 'vendors' ? { label: 'New vendor', run: () => addVendor() } : section === 'orders' ? { label: 'New order', run: () => addOrder(m) } : section === 'contracts' ? { label: 'New contract', run: () => addContract(m) } : { label: 'New quote', run: () => addQuote(m) };

  let body: ReactNode;
  if (error) body = <p className="rm-failed">{error}</p>;
  else if (!m) body = <div className="view-loading" />;
  else if (detail) {
    const key = detail.key;
    if (detail.kind === 'vendor') {
      const v = m.vendors.find((x) => x.path === key || x.name === key);
      body = v ? (
        <VendorDetailShell title={v.name} line={[v.category, v.contact].filter(Boolean).join(' · ') || 'A vendor'} path={v.path || null} canEdit={canEdit}>
          <VendorDetail v={v} m={m} canEdit={canEdit} />
        </VendorDetailShell>
      ) : (
        <PackShell glyph="◇" tint="amber" title="That vendor isn’t here any more" sub="It may have been renamed or moved to Recently deleted." menu={() => vendorsMenu(m, canEdit, save)}>
          <p>
            <button type="button" className="btn" onClick={() => openModule('vendors', 'vendors')}>
              All vendors
            </button>
          </p>
        </PackShell>
      );
    } else if (detail.kind === 'quote') {
      const q = m.quotes.find((x) => x.path === key);
      body = q ? (
        <VendorDetailShell title={q.name} line={[q.vendor, q.project, q.reference ? `ref ${q.reference}` : ''].filter(Boolean).join(' · ')} path={q.path} canEdit={canEdit}>
          <QuoteDetail q={q} m={m} canEdit={canEdit} />
        </VendorDetailShell>
      ) : (
        <PackShell glyph="◇" tint="amber" title="That quote isn’t here any more" sub="It may have been renamed or moved to Recently deleted." menu={() => vendorsMenu(m, canEdit, save)}>
          <p>
            <button type="button" className="btn" onClick={() => openModule('vendors', 'quotes')}>
              All quotes
            </button>
          </p>
        </PackShell>
      );
    } else if (detail.kind === 'order') {
      const o = m.orders.find((x) => x.path === key);
      body = o ? (
        <OrderDetail o={o} m={m} canEdit={canEdit} />
      ) : (
        <PackShell glyph="◇" tint="amber" title="That order isn’t here any more" sub="It may have been renamed or moved to Recently deleted." menu={() => vendorsMenu(m, canEdit, save)}>
          <p>
            <button type="button" className="btn" onClick={() => openModule('vendors', 'orders')}>
              All orders
            </button>
          </p>
        </PackShell>
      );
    } else {
      const c = m.contracts.find((x) => x.path === key);
      body = c ? (
        <VendorDetailShell title={c.name} line={[c.vendor, c.project, c.reference].filter(Boolean).join(' · ')} path={c.path} canEdit={canEdit}>
          <ContractDetail c={c} m={m} canEdit={canEdit} />
        </VendorDetailShell>
      ) : (
        <PackShell glyph="◇" tint="amber" title="That contract isn’t here any more" sub="It may have been renamed or moved to Recently deleted." menu={() => vendorsMenu(m, canEdit, save)}>
          <p>
            <button type="button" className="btn" onClick={() => openModule('vendors', 'contracts')}>
              All contracts
            </button>
          </p>
        </PackShell>
      );
    }
  } else if (section === 'overview' && !m.vendors.length && !m.quotes.length && !m.contracts.length && !m.orders.length)
    body = (
      <PackShell glyph="◇" tint="amber" title={packName('vendors', 'Suppliers')} sub="Vendors, quotes, orders and contracts, each tied to its project." menu={() => vendorsMenu(m, canEdit, save)}>
        <EmptyState icon="briefcase" title="Your vendors, quotes and contracts" line="Add a quote to be told before it lapses and to compare it with others; add a contract to be told before its notice day and its end. Everything here is Work-confidential." action={{ label: 'Add a quote', icon: 'plus', run: () => addQuote(m), disabled: !canEdit }} also={{ label: 'Add a vendor', icon: 'briefcase', run: () => addVendor(), disabled: !canEdit }} />
      </PackShell>
    );
  else if (section === 'overview') body = <Overview m={m} canEdit={canEdit} />;
  else if (section === 'compare')
    body = (
      <VendorsSection m={m} canEdit={canEdit} label="Compare quotes" line="Quotes for the same project side by side, item by item." add={{ label: 'New quote', run: () => addQuote(m) }} save={save}>
        <Compare m={m} canEdit={canEdit} />
      </VendorsSection>
    );
  else
    body = (
      <VendorsSection m={m} canEdit={canEdit} label={info.label} line={info.line} add={add} save={save}>
        <WorkViews
          module="vendors"
          section={section}
          made={vendorSectionViews(section)}
          records={records}
          addKinds={section === 'vendors' ? ['vendor'] : section === 'quotes' ? ['quote'] : section === 'orders' ? ['order'] : ['contract']}
          onAdd={async (kind, words) => {
            // After-add rule (9.2 uplift F43): it went to the list — its name, and a link that opens it. Never auto-open.
            const w = words.trim();
            if (!w) return false;
            let rel = '';
            if (kind === 'vendor') return (await workDid(call<string>('add-vendor', { name: w }).then((p) => (rel = p)), `Added ${w}.`, { label: 'Open', run: () => openDetail('vendors', 'vendor', rel) })) !== null;
            const at = kind === 'quote' ? 'quote' : kind === 'order' ? 'order' : 'contract';
            const said = kind === 'quote' ? `Added a quote from ${w}. Give it its amount and valid-until day.` : kind === 'order' ? `Added a purchase order with ${w}.` : `Added a contract with ${w}. Give it its end day.`;
            const r = await workDid(
              (kind === 'quote' ? call<{ path: string }>('add-quote', { vendor: w }).then((q) => (rel = q.path)) : call<string>(kind === 'order' ? 'add-order' : 'add-contract', { vendor: w }).then((p) => (rel = p))),
              said,
              { label: 'Open', run: () => openDetail('vendors', at, rel) },
            );
            return r !== null;
          }}
        />
      </VendorsSection>
    );
  // The 8.7 pages stand in the module's own scope (p15, Nov 2026): the pack sheets' per-pack rules hang under it.
  return (
    <div className="wm-vendors">
      <WithRecords ctx={ctx}>
        {body}
      </WithRecords>
    </div>
  );
}

// ── Today ────────────────────────────────────────────────────────────────────────────────────────────────────────────

export function VendorsToday() {
  const on = useOn();
  const { data: m } = useWork<View>('vendors');
  if (!m) return null;
  const items = m.attention.filter((a) => a.kind !== 'order' && (a.kind !== 'contract' || on.contracts));
  if (!items.length) return null;
  return (
    <section className="td-section rm-today wv-today" data-section="vendors" aria-labelledby="td-h-vendors">
      <header className="td-section-head">
        <h2 id="td-h-vendors">
          Quotes and contracts
          <span className="td-count">{items.length}</span>
        </h2>
        <button type="button" className="td-section-link" onClick={() => openModule('vendors')}>
          <Icon name="briefcase" size={13} /> Vendors
        </button>
      </header>
      <ul className="rm-today-rows">
        {items.map((a) => (
          <li key={a.key} className={`rm-today-row${a.tone === 'bad' ? ' is-late' : ''}`}>
            <button type="button" className="rm-today-main" onClick={() => openDetail('vendors', a.kind, a.path)}>
              <span className="rm-today-name">{a.words}</span>
              <span className="rm-today-sub">{a.sub}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
