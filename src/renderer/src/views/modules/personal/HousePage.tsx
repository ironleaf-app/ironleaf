// Home's page (Wave 7 part a; src/shared/house.ts, src/main/personal/house.ts). Made of the work modules' shared blocks:
// an Overview of maintenance due (each with Done) and warranties ending, with the home at a glance; House (rooms,
// utilities, and the printer and network notes, changed cell by cell), Appliances, Maintenance, Warranties and Manuals;
// each appliance's own page ("appliance:<path>": details, service history, its jobs, manuals and receipts) and each job's
// ("upkeep:<path>": how often, when, and each time it was done). Everything shown changes where it is.

import { useMemo, useState } from 'react';
import { partOn } from '../../../../../shared/life-modules';
import { APPLIANCE_KINDS, APPLIANCE_STATUSES, HOUSE, OWNERSHIP, UPKEEP_EVERY, UPKEEP_STATUSES, UTILITY_KINDS } from '../../../../../shared/personal-modules';
import { houseRecords, houseSectionViews, HOUSE_EDITABLE, jobWords, SEASONAL_PACKS, utilityBillMatch, warrantyChecklist, warrantyWords, type Appliance, type Home, type HouseModel, type Job } from '../../../../../shared/house';
import type { WsRecord } from '../../../../../shared/workspace-records';
import { EmptyState } from '../../../components/EmptyState';
import { Icon, type IconName } from '../../../components/Icon';
import { openMenu, type MenuItem } from '../../../components/Menu';
import { fileUrl } from '../../../lib/resolve';
import * as A from '../../../state/actions';
import { openModule, partOfTab, useModules } from '../../../state/modules';
import { ApplianceDetail, HouseOverview, appliancePathOf, housePlace } from '../w3b/House87';
import { useApp } from '../../../state/store';
import { useWork, workDid } from '../../../state/workModules';
import type * as W from '../../../state/workspace';
import { openRecordForm, valueWords } from '../RecordForm';
import { Card, dayText, openDetail, Pill, placeOf, Tile, useWorkCtx, WithRecords, WorkShell, WorkViews } from '../work/WorkShell';
import { houseNeeds } from '../../../../../shared/module-purpose';
import { NeedsYou } from '../NeedsYou';
import { afterLead, leadKeys } from '../needsLead';
import { caller, EditTable, Fact, fileName, FilesList, Inline, keepFiles, money, plural } from './PersonalParts';

export type HouseView = HouseModel & { folder: string; currency: string; people: string[] };

const MOD = 'house';
const call = caller(MOD);
export const openAppliance = (rel: string) => openDetail(MOD, 'appliance', rel);
export const openJob = (rel: string) => openDetail(MOD, 'upkeep', rel);
const KIND_ICON: Partial<Record<string, IconName>> = { Fridge: 'bolt', TV: 'present', Printer: 'file', Router: 'branch', Computer: 'computer', 'Air conditioner': 'sun', Heater: 'sun', 'Hot water': 'bolt', Tool: 'settings' };
const applianceIcon = (k: string): IconName => KIND_ICON[k] ?? 'bolt';
export const jobTone = (j: Job) => (j.state === 'Overdue' ? 'bad' : j.state === 'Due soon' ? 'warn' : j.state === 'Later' ? 'ok' : 'none');
export const warrantyTone = (a: Appliance) => (a.warrantyState === 'Out of warranty' ? 'bad' : a.warrantyState === 'Warranty ends soon' ? 'warn' : a.warrantyState === 'Under warranty' ? 'ok' : 'none');

// ── Doing things ─────────────────────────────────────────────────────────────────────────────────────────────────────

export async function save(kind: string, rel: string, field: string, value: string, row?: { row: number; title: string }): Promise<boolean> {
  return (await workDid(call<string | null>('set-field', { kind, path: rel, field, value, ...(row ? { ref: { row: row.row }, title: row.title } : {}) }).then((said) => ({ said })), (x) => x.said ?? '')) !== null;
}

export function newHome(): void {
  openRecordForm({
    title: 'Your home',
    icon: 'home',
    line: 'Its rooms, utilities, and the printer and network notes are kept with it. Passwords go in Secrets.',
    ok: 'Add it',
    fields: [
      { key: 'name', label: 'Name', kind: 'text', value: 'Home', required: true, hint: 'What you call it (“Home”, “The beach house”).' },
      { key: 'ownership', label: 'Owned or renting', kind: 'segment', options: [...OWNERSHIP], value: 'Owned' },
      { key: 'address', label: 'Address', kind: 'text', wide: true },
      { key: 'moved_in', label: 'Moved in', kind: 'date' },
    ],
    submit: async (v) => {
      const rel = await call<string>('add-home', { name: valueWords(v, 'name'), ownership: valueWords(v, 'ownership'), address: valueWords(v, 'address'), moved_in: valueWords(v, 'moved_in') });
      await workDid(Promise.resolve(rel), `Added ${A.titleOf(rel)}.`, { label: 'Open', run: () => openModule(MOD, 'house') });
    },
  });
}

export function newAppliance(m: HouseView | null, prefill: { room?: string } = {}): void {
  const rooms = [...new Set((m?.homes ?? []).flatMap((h) => h.rooms.map((r) => r.values.room)).filter(Boolean))];
  openRecordForm({
    title: 'New appliance',
    icon: 'bolt',
    line: 'Its warranty comes to Today before it ends, and its manual is one click away.',
    ok: 'Add the appliance',
    fields: [
      { key: 'kind', label: 'Kind', kind: 'choice', options: [...APPLIANCE_KINDS], value: 'Other', own: true },
      { key: 'room', label: 'Room', kind: 'choice', options: ['', ...rooms], own: true, value: prefill.room ?? '' },
      { key: 'make', label: 'Make', kind: 'text' },
      { key: 'model', label: 'Model', kind: 'text' },
      { key: 'serial', label: 'Serial', kind: 'text' },
      { key: 'supplier', label: 'Bought from', kind: 'text' },
      { key: 'purchased', label: 'Purchased', kind: 'date' },
      { key: 'price', label: 'Price', kind: 'money' },
      { key: 'warranty', label: 'Warranty ends', kind: 'date' },
      { key: 'name', label: 'Name (optional)', kind: 'text', hint: 'Its make and kind when left empty.' },
      { key: 'files', label: 'Manual or receipt', kind: 'files', wide: true },
    ],
    submit: async (v) => {
      const rel = await call<string>('add-appliance', Object.fromEntries(['kind', 'room', 'make', 'model', 'serial', 'supplier', 'purchased', 'price', 'warranty', 'name'].map((k) => [k, valueWords(v, k)])));
      const files = Array.isArray(v.files) ? v.files : [];
      if (files.length) await call('keep-files', rel, files);
      await workDid(Promise.resolve(rel), `Added ${A.titleOf(rel)}.`, { label: 'Open', run: () => openAppliance(rel) });
    },
  });
}

export function newJob(m: HouseView | null, prefill: { appliance?: string; room?: string } = {}): void {
  openRecordForm({
    title: 'New maintenance job',
    icon: 'task',
    line: 'A job that comes round. It shows on Today when it is due, and moves on each time you mark it done.',
    ok: 'Add the job',
    fields: [
      { key: 'name', label: 'Job', kind: 'text', required: true, wide: true, placeholder: 'Clean the gutters' },
      { key: 'every', label: 'How often', kind: 'choice', options: [...UPKEEP_EVERY], value: 'Yearly' },
      { key: 'last_done', label: 'Last done', kind: 'date', hint: 'The next day is worked out from it.' },
      { key: 'next_due', label: 'Next due', kind: 'date', hint: 'Or set it yourself.' },
      { key: 'appliance', label: 'Appliance', kind: 'choice', options: ['', ...(m?.appliances.map((a) => a.name) ?? [])], value: prefill.appliance ?? '' },
      { key: 'room', label: 'Room', kind: 'text', value: prefill.room ?? '' },
      { key: 'who', label: 'Who does it', kind: 'choice', options: ['', ...(m?.people ?? [])], own: true },
      { key: 'cost', label: 'Usual cost', kind: 'money' },
    ],
    submit: async (v) => {
      const rel = await call<string>('add-job', Object.fromEntries(['name', 'every', 'last_done', 'next_due', 'appliance', 'room', 'who', 'cost'].map((k) => [k, valueWords(v, k)])));
      await workDid(Promise.resolve(rel), `Added “${A.titleOf(rel)}”.`, { label: 'Open', run: () => openJob(rel) });
    },
  });
}

export function markDone(j: Job, m: HouseView | null, quick = false): void {
  if (quick) {
    void workDid(call<string>('mark-done', j.path, {}));
    return;
  }
  openRecordForm({
    title: `“${j.name}” done`,
    icon: 'check',
    line: j.every === 'Once' ? 'It doesn’t come round: it is marked done.' : `It comes round ${j.every.toLowerCase()}: the next day is worked out from this one.`,
    ok: 'Mark it done',
    fields: [
      { key: 'date', label: 'Done on', kind: 'date', value: m?.today ?? '' },
      { key: 'by', label: 'By', kind: 'choice', options: ['', ...(m?.people ?? [])], own: true, value: j.who },
      { key: 'cost', label: 'Cost', kind: 'money', value: j.cost !== null ? String(j.cost) : '' },
      { key: 'notes', label: 'Notes', kind: 'text', wide: true },
    ],
    submit: async (v) => {
      await workDid(call<string>('mark-done', j.path, { date: valueWords(v, 'date'), by: valueWords(v, 'by'), cost: valueWords(v, 'cost'), notes: valueWords(v, 'notes') }));
    },
  });
}

export function addHistory(a: Appliance, today: string): void {
  openRecordForm({
    title: `A service or repair for the ${a.name}`,
    icon: 'settings',
    ok: 'Add it',
    fields: [
      { key: 'what', label: 'What was done', kind: 'text', required: true, wide: true, placeholder: 'Replaced the door seal' },
      { key: 'date', label: 'Date', kind: 'date', value: today },
      { key: 'by', label: 'By', kind: 'text' },
      { key: 'cost', label: 'Cost', kind: 'money' },
    ],
    submit: async (v) => {
      await workDid(call<string>('add-row', a.path, 'history', { date: valueWords(v, 'date'), what: valueWords(v, 'what'), by: valueWords(v, 'by'), cost: valueWords(v, 'cost') }));
    },
  });
}

function addRow(h: Home, table: 'rooms' | 'utilities' | 'network'): void {
  const spec =
    table === 'rooms'
      ? { title: 'New room', icon: 'grid' as IconName, fields: [{ key: 'room', label: 'Room', kind: 'text' as const, required: true, placeholder: 'Kitchen' }, { key: 'floor', label: 'Floor', kind: 'text' as const, placeholder: 'Ground' }, { key: 'notes', label: 'Notes', kind: 'text' as const, wide: true }] }
      : table === 'utilities'
        ? { title: 'New utility', icon: 'bolt' as IconName, fields: [{ key: 'utility', label: 'Utility', kind: 'choice' as const, options: [...UTILITY_KINDS], value: 'Electricity', own: true }, { key: 'provider', label: 'Provider', kind: 'text' as const }, { key: 'plan', label: 'Plan', kind: 'text' as const }, { key: 'account', label: 'Account number', kind: 'text' as const, hint: 'A reference only. Logins go in Secrets.' }, { key: 'phone', label: 'Phone', kind: 'text' as const }, { key: 'notes', label: 'Notes', kind: 'text' as const, wide: true }] }
        : { title: 'New printer or network note', icon: 'branch' as IconName, fields: [{ key: 'thing', label: 'Thing', kind: 'text' as const, required: true, placeholder: 'Printer' }, { key: 'details', label: 'Details', kind: 'text' as const, wide: true, placeholder: 'Model, where it is, the ink it takes', hint: 'Never a password: those go in Secrets.' }, { key: 'notes', label: 'Notes', kind: 'text' as const, wide: true }] };
  openRecordForm({
    title: spec.title,
    icon: spec.icon,
    ok: 'Add it',
    fields: spec.fields,
    submit: async (v) => {
      await workDid(call<string>('add-row', h.path, table, Object.fromEntries(spec.fields.map((f) => [f.key, valueWords(v, f.key)]))));
    },
  });
}

export function houseOptions(remind: number, jobDays: number): void {
  openRecordForm({
    title: 'House options',
    icon: 'settings',
    ok: 'Save',
    fields: [
      { key: 'remind', label: 'Say a warranty is ending this many days ahead', kind: 'number', value: String(remind), hint: '60 unless you change it.' },
      { key: 'jobs', label: 'Show maintenance as due this many days ahead', kind: 'number', value: String(jobDays), hint: '14 unless you change it.' },
    ],
    submit: async (v) => {
      const n = (k: string) => Math.max(0, Math.round(Number(valueWords(v, k)) || 0));
      await workDid(call('options', { remindDays: Math.min(365, n('remind')), jobDays: Math.min(90, n('jobs')) }), 'Saved the House options.');
    },
  });
}

function jobMenu(j: Job, m: HouseView, canEdit: boolean): MenuItem[] {
  return [
    { label: 'Open', icon: 'eye', run: () => openJob(j.path) },
    { separator: true },
    { label: 'Done today', icon: 'check', disabled: !canEdit, run: () => markDone(j, m, true) },
    { label: 'Done on another day…', icon: 'calendar', disabled: !canEdit, run: () => markDone(j, m) },
    { label: j.status === 'Paused' ? 'Start it again' : 'Pause it', icon: 'pause', disabled: !canEdit, run: () => void save('upkeep', j.path, 'status', j.status === 'Paused' ? 'Active' : 'Paused') },
    { separator: true },
    { label: 'Open its note', icon: 'notes', run: () => A.openPath(j.path, { where: 'tab' }) },
  ];
}

// ── Rows and cards ───────────────────────────────────────────────────────────────────────────────────────────────────

function JobRow({ j, m, canEdit }: { j: Job; m: HouseView; canEdit: boolean }) {
  return (
    <li className={`rm-row${j.state === 'Overdue' ? ' is-late' : j.state === 'Due soon' ? ' is-soon' : ''}`}>
      <button type="button" className="rm-row-main" onClick={() => openJob(j.path)}>
        <span className="rm-row-icon" aria-hidden="true">
          <Icon name="task" size={14} />
        </span>
        <span className="rm-row-words">
          <span className="rm-row-name">{j.name}</span>
          <span className="rm-row-sub">{[jobWords(j, m.today), j.lastDone ? `last done ${dayText(j.lastDone)}` : 'never marked done', j.every.toLowerCase(), j.appliance || j.room, j.who].filter(Boolean).join(' · ')}</span>
        </span>
      </button>
      <span className="rm-row-end">
        {j.state !== 'Paused' && j.state !== 'Done' && (
          <button type="button" className="button small" disabled={!canEdit} onClick={() => markDone(j, m, true)} title="Done today: its next day moves on (another day is in the menu)">
            <Icon name="check" size={12} /> Done
          </button>
        )}
        <button type="button" className="icon-button small" aria-label={`More for ${j.name}`} onClick={(e) => openMenu(e.currentTarget, jobMenu(j, m, canEdit))}>
          <Icon name="more" size={13} />
        </button>
      </span>
    </li>
  );
}

function ApplianceCard({ a }: { a: Appliance }) {
  const photo = a.photos[0];
  return (
    <li className={`pm-card${/^(replaced|sold)$/i.test(a.status) ? ' is-gone' : ''}`}>
      <button type="button" className="pm-card-main" onClick={() => openAppliance(a.path)}>
        <span className="pm-card-pic" aria-hidden="true">
          {photo ? <img src={fileUrl(photo)} alt="" loading="lazy" /> : <Icon name={applianceIcon(a.kind)} size={20} />}
        </span>
        <span className="pm-card-words">
          <span className="pm-card-name">{a.name}</span>
          <span className="pm-card-sub">{[a.room, [a.make, a.model].filter(Boolean).join(' ')].filter(Boolean).join(' · ') || a.kind}</span>
        </span>
      </button>
      <div className="pm-card-stats">
        {a.status !== 'In use' && <Pill tone={a.status === 'Needs repair' ? 'warn' : 'none'}>{a.status}</Pill>}
        {a.warrantyState && <Pill tone={warrantyTone(a)} title={a.warranty ? `Warranty ends ${dayText(a.warranty)}` : undefined}>{a.warrantyState}</Pill>}
        <span className="pm-card-gap" />
        {a.manuals.length > 0 && (
          <span className="pm-faint">
            <Icon name="file" size={11} /> {plural(a.manuals.length, 'manual or document', 'manuals and documents')}
          </span>
        )}
      </div>
    </li>
  );
}

// ── Overview ─────────────────────────────────────────────────────────────────────────────────────────────────────────

function HomeGlance({ h, m }: { h: Home; m: HouseView }) {
  return (
    <div className="pm-glance">
      <div className="pm-glance-head">
        <span className="pm-card-pic" aria-hidden="true">
          {h.photos[0] ? <img src={fileUrl(h.photos[0])} alt="" /> : <Icon name="home" size={20} />}
        </span>
        <div className="pm-card-words">
          <span className="pm-card-name">{h.name}</span>
          <span className="pm-card-sub">{[h.address, h.ownership].filter(Boolean).join(' · ') || 'No address yet'}</span>
        </div>
      </div>
      <dl className="pm-glance-list">
        <div>
          <dt>Rooms</dt>
          <dd>{h.rooms.length ? h.rooms.map((r) => r.values.room).join(', ') : ''}</dd>
        </div>
        {h.utilities.map((u) => {
          const bill = utilityBillMatch(u.values, m.bills);
          return (
            <div key={`u${u.row}`}>
              <dt>{u.values.utility}</dt>
              <dd>{[u.values.provider, u.values.phone, bill ? `its bill is in Money${bill.due ? `, due ${dayText(bill.due)}` : ''}` : ''].filter(Boolean).join(' · ') || ''}</dd>
            </div>
          );
        })}
        {h.network.slice(0, 4).map((n) => (
          <div key={`n${n.row}`}>
            <dt>{n.values.thing}</dt>
            <dd>{n.values.details || ''}</dd>
          </div>
        ))}
      </dl>
      <button type="button" className="text-button" onClick={() => openModule(MOD, 'house')}>
        Rooms, utilities and network <Icon name="chevron" size={11} />
      </button>
      {m.homes.length > 1 && <p className="pm-faint">{plural(m.homes.length - 1, 'other home')} on the House page.</p>}
    </div>
  );
}

function Overview({ m, canEdit }: { m: HouseView; canEdit: boolean }) {
  const modules = useModules();
  const jobsOn = partOn(modules, MOD, 'maintenance');
  const warrOn = partOn(modules, MOD, 'warranties');
  const late = m.due.filter((j) => j.state === 'Overdue').length;
  const live = m.appliances.filter((a) => !/^(replaced|sold)$/i.test(a.status));
  const manuals = m.appliances.reduce((n, a) => n + a.manuals.length, 0);
  const next = m.jobs.find((j) => j.state === 'Later');
  const needsCards = houseNeeds(jobsOn ? m.due : [], warrOn ? m.warranties : [], m.today);
  const keys = leadKeys(needsCards, m.today);
  // The lists below start after Needs you: a job or warranty already shown there is not repeated.
  const dueLeft = afterLead(m.due, keys, (j) => [`job:${j.path}`, j.path, j.name]);
  const warrantiesLeft = afterLead(m.warranties, keys, (a) => [`warranty:${a.path}`, a.path, `${a.name}: warranty`]);
  return (
    <div className="rm-overview">
      <NeedsYou cards={needsCards} today={m.today} canEdit={canEdit} onAction={(c) => { if (c.ref) openDetail(MOD, c.id.startsWith('job:') ? 'upkeep' : 'appliance', c.ref); }} />
      <div className="rm-tiles">
        {jobsOn && <Tile icon="task" label="Maintenance due" value={String(m.due.length)} sub={late ? `${late} overdue` : m.due.length ? `In the next ${plural(m.jobDays, 'day')}` : next ? `Next: ${next.name}, ${dayText(next.nextDue)}` : 'Nothing due'} tone={late ? 'bad' : m.due.length ? 'warn' : 'ok'} onClick={() => openModule(MOD, 'maintenance')} />}
        <Tile icon="bolt" label="Appliances" value={String(live.length)} sub={live.filter((a) => a.status === 'Needs repair').length ? `${live.filter((a) => a.status === 'Needs repair').length} need repair` : 'All in use'} onClick={() => openModule(MOD, 'appliances')} />
        {warrOn && <Tile icon="clock" label="Warranties ending" value={String(m.warranties.filter((a) => (a.warrantyDays ?? -1) >= 0).length)} sub={`In the next ${plural(m.remindDays, 'day')}`} tone={m.warranties.some((a) => (a.warrantyDays ?? -1) >= 0) ? 'warn' : undefined} onClick={() => openModule(MOD, 'warranties')} />}
        <Tile icon="file" label="Manuals kept" value={String(manuals)} sub={manuals ? `For ${plural(m.appliances.filter((a) => a.manuals.length).length, 'appliance')}` : 'Keep each manual with its appliance'} onClick={() => openModule(MOD, 'manuals')} />
      </div>
      <div className="rm-cols">
        <div className="pm-stack">
          {jobsOn && (dueLeft.length > 0 || !m.due.length) && (
            <Card id="jobs" title="Maintenance due" count={dueLeft.length} link={{ label: 'Maintenance', run: () => openModule(MOD, 'maintenance') }}>
              {dueLeft.length ? (
                <ul className="rm-rows">
                  {dueLeft.map((j) => (
                    <JobRow key={j.path} j={j} m={m} canEdit={canEdit} />
                  ))}
                </ul>
              ) : (
                <p className="rm-none">{m.jobs.length ? `Nothing is due in the next ${plural(m.jobDays, 'day')}.` : 'No maintenance jobs yet. Add the jobs that come round (gutters, smoke alarms, the air conditioner’s filter) to be told when each is due.'}</p>
              )}
            </Card>
          )}
          {warrOn && warrantiesLeft.length > 0 && (
            <Card id="warranties" title="Warranties ending" count={warrantiesLeft.length} link={{ label: 'Warranties', run: () => openModule(MOD, 'warranties') }}>
              <ul className="rm-rows">
                {warrantiesLeft.map((a) => (
                  <li key={a.path} className={`rm-row${(a.warrantyDays ?? 0) < 0 ? ' is-late' : ' is-soon'}`}>
                    <button type="button" className="rm-row-main" onClick={() => openAppliance(a.path)}>
                      <span className="rm-row-icon" aria-hidden="true">
                        <Icon name={applianceIcon(a.kind)} size={14} />
                      </span>
                      <span className="rm-row-words">
                        <span className="rm-row-name">{a.name}</span>
                        <span className="rm-row-sub">{[warrantyWords(a, m.today), a.supplier && `from ${a.supplier}`, a.manuals.length ? 'receipt kept' : ''].filter(Boolean).join(' · ')}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
        <Card id="home" title="Your home" link={m.homes.length ? undefined : { label: 'Add your home', run: () => newHome() }}>
          {m.homes[0] ? <HomeGlance h={m.homes[0]} m={m} /> : <p className="rm-none">Add your home to keep its rooms, utilities, and the printer and network notes together.</p>}
        </Card>
      </div>
    </div>
  );
}

// ── House ────────────────────────────────────────────────────────────────────────────────────────────────────────────

function HousePart({ m, canEdit }: { m: HouseView; canEdit: boolean }) {
  const [pick, setPick] = useState(0);
  const h = m.homes[Math.min(pick, m.homes.length - 1)];
  if (!h) return <EmptyState size="panel" icon="home" title="No home yet" line="Add your home to keep its rooms, utilities and network notes together." action={{ label: 'Add your home', icon: 'plus', run: () => newHome(), disabled: !canEdit }} />;
  const cell = (kind: string) => (row: number, title: string, field: string, value: string) => save(kind, h.path, field, value, { row, title });
  const remove = (table: string) => (row: number, title: string) => void workDid(call<string>('remove-row', h.path, table, row, title));
  const prop = (field: string) => (v: string) => save('house', h.path, field, v);
  const add = (table: 'rooms' | 'utilities' | 'network', label: string) =>
    canEdit ? (
      <button type="button" className="text-button" onClick={() => addRow(h, table)}>
        <Icon name="plus" size={12} /> {label}
      </button>
    ) : undefined;
  return (
    <div className="pm-reg">
      {m.homes.length > 1 && (
        <div className="pm-chips pm-span" role="group" aria-label="Homes">
          {m.homes.map((x, i) => (
            <button key={x.path} type="button" className={`pm-chip${x === h ? ' is-on' : ''}`} aria-pressed={x === h} onClick={() => setPick(i)}>
              {x.name}
            </button>
          ))}
        </div>
      )}
      <div className="pm-reg-main">
        <Card id="rooms" title="Rooms" count={h.rooms.length} actions={add('rooms', 'Add a room')}>
          {h.rooms.length ? (
            <EditTable
              label="Rooms"
              rows={h.rooms.map((r) => ({ row: r.row, values: { ...r.values, appliances: String(m.appliances.filter((a) => r.values.room && a.room.toLowerCase() === r.values.room.toLowerCase()).length) } }))}
              cols={[
                { key: 'room', label: 'Room', kind: 'text', strong: true },
                { key: 'floor', label: 'Floor', kind: 'text' },
                { key: 'appliances', label: 'Appliances', kind: 'readonly', num: true, shown: (x) => x || '0' },
                { key: 'notes', label: 'Notes', kind: 'text' },
              ]}
              title="room"
              canEdit={canEdit}
              onSave={cell('room')}
              onRemove={remove('rooms')}
            />
          ) : (
            <p className="rm-none">No rooms yet. Add the kitchen, the laundry and the rest to place appliances in them.</p>
          )}
        </Card>
        <Card id="utilities" title="Utilities" count={h.utilities.length} actions={add('utilities', 'Add a utility')}>
          {h.utilities.length ? (
            <EditTable
              label="Utilities"
              rows={h.utilities.map((u) => ({ row: u.row, values: u.values }))}
              cols={[
                { key: 'utility', label: 'Utility', kind: 'text', strong: true },
                { key: 'provider', label: 'Provider', kind: 'text' },
                { key: 'plan', label: 'Plan', kind: 'text' },
                { key: 'account', label: 'Account', kind: 'text' },
                { key: 'phone', label: 'Phone', kind: 'text' },
                { key: 'notes', label: 'Notes', kind: 'text' },
              ]}
              title="utility"
              canEdit={canEdit}
              onSave={cell('utility')}
              onRemove={remove('utilities')}
            />
          ) : (
            <p className="rm-none">Add who supplies the power, gas, water and internet, with the number to call.</p>
          )}
        </Card>
        <Card id="network" title="Network and printers" count={h.network.length} actions={add('network', 'Add a line')}>
          {h.network.length ? (
            <EditTable
              label="Network and printers"
              rows={h.network.map((n) => ({ row: n.row, values: n.values }))}
              cols={[
                { key: 'thing', label: 'Thing', kind: 'text', strong: true },
                { key: 'details', label: 'Details', kind: 'text' },
                { key: 'notes', label: 'Notes', kind: 'text' },
              ]}
              title="thing"
              canEdit={canEdit}
              onSave={cell('network')}
              onRemove={remove('network')}
            />
          ) : (
            <p className="rm-none">The router, the Wi-Fi’s name, the printer and the ink it takes.</p>
          )}
          <p className="pm-note">
            <Icon name="lock" size={12} /> Wi-Fi and router passwords go in Secrets, never here: assistants are never given them.
          </p>
        </Card>
      </div>
      <aside className="pm-reg-side">
        <Card id="details" title="Details">
          <div className="pm-facts">
            <Fact label="Address">
              <Inline value={h.address} label="Address" placeholder="Add the address" canEdit={canEdit} onSave={prop('address')} />
            </Fact>
            <Fact label="Owned">
              <Inline value={h.ownership} label="Owned or renting" kind="choice" options={['', ...OWNERSHIP]} canEdit={canEdit} onSave={prop('ownership')} />
            </Fact>
            <Fact label="Moved in">
              <Inline value={h.movedIn ?? ''} shown={h.movedIn ? dayText(h.movedIn) : undefined} label="Moved in" kind="date" canEdit={canEdit} onSave={prop('moved_in')} />
            </Fact>
            <Fact label={h.ownership === 'Renting' ? 'Agent' : 'Contact'}>
              <Inline value={h.contact} label="Landlord or agent" kind="choice" options={['', ...m.people]} placeholder="Choose someone" canEdit={canEdit} onSave={prop('contact')} />
            </Fact>
          </div>
        </Card>
        <Card
          id="files"
          title="Photos and papers"
          count={h.files.length}
          actions={
            canEdit ? (
              <button type="button" className="text-button" onClick={() => void keepFiles(MOD, h.path, h.name)}>
                <Icon name="plus" size={12} /> Add
              </button>
            ) : undefined
          }
        >
          <FilesList files={h.files} empty="Keep the lease or contract, plans and photos of the house here." />
        </Card>
      </aside>
    </div>
  );
}

// ── An appliance's and a job's pages ─────────────────────────────────────────────────────────────────────────────────

function AppliancePage({ a, m, canEdit }: { a: Appliance; m: HouseView; canEdit: boolean }) {
  const prop = (field: string) => (v: string) => save('appliance', a.path, field, v);
  const jobs = m.jobs.filter((j) => a.jobs.includes(j.path));
  const rooms = [...new Set(m.homes.flatMap((h) => h.rooms.map((r) => r.values.room)).filter(Boolean))];
  const history = [...a.history].sort((x, y) => (y.date ?? '').localeCompare(x.date ?? ''));
  return (
    <div className="pm-reg">
      <div className="pm-reg-main">
        <Card
          id="manuals"
          title="Manuals and receipts"
          count={a.files.length}
          actions={
            canEdit ? (
              <button type="button" className="text-button" onClick={() => void keepFiles(MOD, a.path, a.name, 'documents')}>
                <Icon name="plus" size={12} /> Add
              </button>
            ) : undefined
          }
        >
          <FilesList files={a.files} empty="Keep its manual, the receipt and the warranty card here, so they are there when it breaks." />
        </Card>
        <Card
          id="history"
          title="Service history"
          count={a.history.length}
          actions={
            canEdit ? (
              <button type="button" className="text-button" onClick={() => addHistory(a, m.today)}>
                <Icon name="plus" size={12} /> Add a service or repair
              </button>
            ) : undefined
          }
        >
          {history.length ? (
            <EditTable
              label={`The ${a.name}’s service history`}
              rows={history.map((h) => ({ row: h.row, values: { date: h.date ?? h.dateWords, what: h.what, by: h.by, cost: h.cost !== null ? String(h.cost) : '' } }))}
              cols={[
                { key: 'date', label: 'Date', kind: 'date' },
                { key: 'what', label: 'What', kind: 'text', strong: true },
                { key: 'by', label: 'By', kind: 'text' },
                { key: 'cost', label: 'Cost', kind: 'money', num: true, shown: (x) => (x ? money(Number(x), m.currency) : '') },
              ]}
              title="what"
              canEdit={canEdit}
              onSave={(row, title, field, value) => save('history', a.path, field, value, { row, title })}
              onRemove={(row, title) => void workDid(call<string>('remove-row', a.path, 'history', row, title))}
            />
          ) : (
            <p className="rm-none">No services or repairs yet.</p>
          )}
        </Card>
        <Card
          id="jobs"
          title="Maintenance"
          count={jobs.length}
          actions={
            canEdit ? (
              <button type="button" className="text-button" onClick={() => newJob(m, { appliance: a.name, room: a.room })}>
                <Icon name="plus" size={12} /> Add a job
              </button>
            ) : undefined
          }
        >
          {jobs.length ? (
            <ul className="rm-rows">
              {jobs.map((j) => (
                <JobRow key={j.path} j={j} m={m} canEdit={canEdit} />
              ))}
            </ul>
          ) : (
            <p className="rm-none">Nothing comes round for it yet (a filter to clean, a yearly service).</p>
          )}
        </Card>
      </div>
      <aside className="pm-reg-side">
        {a.warrantyDays !== null && a.warrantyDays <= m.remindDays && (
          <Card id="warranty-check" title="Before the warranty ends">
            <ul className="pm-checklist">
              {warrantyChecklist(a, m.today).map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </Card>
        )}
        <Card id="details" title="Details">
          <div className="pm-facts">
            <Fact label="Kind">
              <Inline value={a.kind} label="Kind" kind="choice" options={[...APPLIANCE_KINDS]} canEdit={canEdit} onSave={prop('appliance_kind')} />
            </Fact>
            <Fact label="Room">
              <Inline value={a.room} label="Room" kind={rooms.length ? 'choice' : 'text'} options={['', ...rooms]} canEdit={canEdit} onSave={prop('room')} />
            </Fact>
            <Fact label="Make">
              <Inline value={a.make} label="Make" canEdit={canEdit} onSave={prop('make')} />
            </Fact>
            <Fact label="Model">
              <Inline value={a.model} label="Model" canEdit={canEdit} onSave={prop('model')} />
            </Fact>
            <Fact label="Serial">
              <Inline value={a.serial} label="Serial" canEdit={canEdit} onSave={prop('serial')} />
            </Fact>
            <Fact label="Purchased">
              <Inline value={a.purchased ?? ''} shown={a.purchased ? dayText(a.purchased) : undefined} label="Purchased" kind="date" canEdit={canEdit} onSave={prop('purchased')} />
            </Fact>
            <Fact label="Price">
              <Inline value={a.price !== null ? String(a.price) : ''} shown={a.price !== null ? money(a.price, m.currency) : undefined} label="Price" kind="number" canEdit={canEdit} onSave={prop('price')} />
            </Fact>
            <Fact label="Bought from">
              <Inline value={a.supplier} label="Bought from" canEdit={canEdit} onSave={prop('supplier')} />
            </Fact>
            <Fact label="Warranty">
              <Inline value={a.warranty ?? ''} shown={a.warranty ? <>{dayText(a.warranty)} {a.warrantyState && <Pill tone={warrantyTone(a)}>{a.warrantyState === 'Under warranty' ? 'Under warranty' : a.warrantyState === 'Out of warranty' ? 'Ended' : 'Ends soon'}</Pill>}</> : undefined} label="Warranty ends" kind="date" canEdit={canEdit} onSave={prop('warranty')} />
            </Fact>
            <Fact label="Status">
              <Inline value={a.status} label="Status" kind="choice" options={[...APPLIANCE_STATUSES]} canEdit={canEdit} onSave={prop('status')} />
            </Fact>
          </div>
        </Card>
      </aside>
    </div>
  );
}

function JobPage({ j, m, canEdit }: { j: Job; m: HouseView; canEdit: boolean }) {
  const prop = (field: string) => (v: string) => save('upkeep', j.path, field, v);
  const done = [...j.done].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
  return (
    <div className="pm-reg">
      <div className="pm-reg-main">
        <Card
          id="done"
          title="Each time it was done"
          count={j.done.length}
          actions={
            canEdit ? (
              <button type="button" className="text-button" onClick={() => markDone(j, m)}>
                <Icon name="check" size={12} /> Mark it done
              </button>
            ) : undefined
          }
        >
          {done.length ? (
            <EditTable
              label={`Each time “${j.name}” was done`}
              rows={done.map((d) => ({ row: d.row, values: { date: d.date ?? '', by: d.by, cost: d.cost !== null ? String(d.cost) : '', notes: d.notes } }))}
              cols={[
                { key: 'date', label: 'Date', kind: 'date', strong: true },
                { key: 'by', label: 'By', kind: 'text' },
                { key: 'cost', label: 'Cost', kind: 'money', num: true, shown: (x) => (x ? money(Number(x), m.currency) : '') },
                { key: 'notes', label: 'Notes', kind: 'text' },
              ]}
              title="date"
              canEdit={canEdit}
              onSave={(row, title, field, value) => save('done', j.path, field, value, { row, title })}
              onRemove={(row, title) => void workDid(call<string>('remove-row', j.path, 'done', row, title))}
            />
          ) : (
            <p className="rm-none">Not marked done yet. Each time you do, it is kept here.</p>
          )}
        </Card>
      </div>
      <aside className="pm-reg-side">
        <Card id="details" title="Details">
          <div className="pm-facts">
            <Fact label="Next due">
              <Inline value={j.nextDue ?? ''} shown={j.nextDue ? <>{dayText(j.nextDue)} <Pill tone={jobTone(j)}>{j.state}</Pill></> : undefined} label="Next due" kind="date" canEdit={canEdit} onSave={prop('next_due')} />
            </Fact>
            <Fact label="How often">
              <Inline value={j.every} label="How often" kind="choice" options={[...UPKEEP_EVERY]} canEdit={canEdit} onSave={prop('every')} />
            </Fact>
            <Fact label="Last done">
              <Inline value={j.lastDone ?? ''} shown={j.lastDone ? dayText(j.lastDone) : undefined} label="Last done" kind="date" canEdit={canEdit} onSave={prop('last_done')} />
            </Fact>
            <Fact label="Appliance">
              <Inline value={j.appliance} label="Appliance" kind="choice" options={['', ...m.appliances.map((a) => a.name)]} canEdit={canEdit} onSave={prop('appliance')} />
            </Fact>
            <Fact label="Room">
              <Inline value={j.room} label="Room" canEdit={canEdit} onSave={prop('room')} />
            </Fact>
            <Fact label="Who">
              <Inline value={j.who} label="Who does it" canEdit={canEdit} onSave={prop('who')} />
            </Fact>
            <Fact label="Usual cost">
              <Inline value={j.cost !== null ? String(j.cost) : ''} shown={j.cost !== null ? money(j.cost, m.currency) : undefined} label="Usual cost" kind="number" canEdit={canEdit} onSave={prop('cost')} />
            </Fact>
            <Fact label="Status">
              <Inline value={j.status} label="Status" kind="choice" options={[...UPKEEP_STATUSES]} canEdit={canEdit} onSave={prop('status')} />
            </Fact>
          </div>
          {j.worked && <p className="pm-note">The next day is worked out from the last time and how often it comes round.</p>}
        </Card>
      </aside>
    </div>
  );
}

// ── Manuals ──────────────────────────────────────────────────────────────────────────────────────────────────────────

function Manuals({ m, canEdit }: { m: HouseView; canEdit: boolean }) {
  const withFiles = m.appliances.filter((a) => a.files.length);
  const without = m.appliances.filter((a) => !a.manuals.length && !/^(replaced|sold)$/i.test(a.status));
  return (
    <div className="rm-overview">
      {withFiles.length ? (
        <div className="pm-manuals">
          {withFiles.map((a) => (
            <Card
              key={a.path}
              id={`man-${a.path}`}
              title={a.name}
              count={a.files.length}
              actions={
                <>
                  <button type="button" className="text-button" onClick={() => openAppliance(a.path)}>
                    Open
                  </button>
                  {canEdit && (
                    <button type="button" className="text-button" onClick={() => void keepFiles(MOD, a.path, a.name, 'documents')}>
                      <Icon name="plus" size={12} /> Add
                    </button>
                  )}
                </>
              }
            >
              <FilesList files={a.files} empty="" />
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState size="panel" icon="file" title="No manuals kept yet" line="Open an appliance and add its manual or receipt: it is kept beside it, in its own folder." />
      )}
      {without.length > 0 && (
        <Card id="without" title="Without a manual" count={without.length}>
          <ul className="pm-files">
            {without.map((a) => (
              <li key={a.path}>
                <button type="button" className="pm-file" disabled={!canEdit} onClick={() => void keepFiles(MOD, a.path, a.name, 'documents')} title={`Add a manual for the ${a.name}`}>
                  <Icon name="plus" size={13} />
                  <span className="pm-file-name">{a.name}</span>
                  <span className="pm-faint">{a.room}</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

// ── The page ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const JOB_GROUPS: Job['state'][] = ['Overdue', 'Due soon', 'Later', 'No date', 'Paused', 'Done'];

export function HouseClassic({ tab }: { tab: W.TabState }) {
  const canEdit = useApp((s) => s.canEdit);
  const modules = useModules();
  const sections = HOUSE.sections.filter((s) => (s.id !== 'maintenance' || partOn(modules, MOD, 'maintenance')) && (s.id !== 'warranties' || partOn(modules, MOD, 'warranties')));
  const { section, detail } = placeOf(tab, HOUSE, sections);
  const { data: m, error } = useWork<HouseView>(MOD);
  const records = useMemo(() => (m ? houseRecords(m) : []), [m]);
  const ctx = useWorkCtx(MOD, records, {
    editable: (r) => HOUSE_EDITABLE[r.kind] ?? [],
    people: m?.people ?? [],
    open: (r: WsRecord, e) => {
      if (!r.path) return;
      if (e?.ctrlKey || e?.metaKey) return A.openPath(r.path, { where: 'tab' });
      if (r.kind === 'appliance') return openAppliance(r.path);
      if (r.kind === 'upkeep') return openJob(r.path);
      openModule(MOD, 'house');
    },
  });
  const a = detail?.kind === 'appliance' && m ? m.appliances.find((x) => x.path === detail.key) : undefined;
  const j = detail?.kind === 'upkeep' && m ? m.jobs.find((x) => x.path === detail.key) : undefined;
  const here = detail ? (detail.kind === 'upkeep' ? 'maintenance' : 'appliances') : section;
  const more = (): MenuItem[] => [
    { label: 'New appliance', icon: 'bolt', disabled: !canEdit, run: () => newAppliance(m) },
    { label: 'New maintenance job', icon: 'task', disabled: !canEdit, run: () => newJob(m, a ? { appliance: a.name, room: a.room } : {}) },
    ...SEASONAL_PACKS.map((p) => ({ label: `Starter pack: ${p.name}`, icon: 'calendar' as IconName, disabled: !canEdit, run: () => void workDid(call<string>('add-seasonal-pack', p.id)) })),
    { label: m?.homes.length ? 'Add another home' : 'Add your home', icon: 'home', disabled: !canEdit, run: () => newHome() },
    ...(a ? ([{ separator: true }, { label: 'Add a manual or receipt…', icon: 'file', disabled: !canEdit, run: () => void keepFiles(MOD, a.path, a.name, 'documents') }, { label: 'Open its note', icon: 'notes', run: () => A.openPath(a.path, { where: 'tab' }) }] as MenuItem[]) : []),
    ...(j ? ([{ separator: true }, { label: 'Open its note', icon: 'notes', run: () => A.openPath(j.path, { where: 'tab' }) }] as MenuItem[]) : []),
    { separator: true },
    { label: 'House options…', icon: 'settings', disabled: !canEdit || !m, run: () => m && houseOptions(m.remindDays, m.jobDays) },
    { label: 'Show the folder', icon: 'folder', disabled: !m, run: () => m && A.revealInExplorer(m.folder) },
  ];
  const primary = a
    ? { label: 'Add a manual', icon: 'file' as IconName, run: () => void keepFiles(MOD, a.path, a.name, 'documents') }
    : j
      ? { label: 'Mark it done', icon: 'check' as IconName, run: () => markDone(j, m) }
      : here === 'maintenance'
        ? { label: 'New job', icon: 'plus' as IconName, run: () => newJob(m) }
        : here === 'house' && !m?.homes.length
          ? { label: 'Add your home', icon: 'plus' as IconName, run: () => newHome() }
          : { label: 'New appliance', icon: 'plus' as IconName, run: () => newAppliance(m) };
  const actions = (
    <>
      {!detail && here !== 'maintenance' && (
        <button type="button" className="sv-tool" disabled={!canEdit} onClick={() => newJob(m)}>
          <Icon name="task" size={14} /> New job
        </button>
      )}
      <button type="button" className="sv-tool nt-new" disabled={!canEdit} onClick={primary.run}>
        <Icon name={primary.icon} size={14} /> {primary.label}
      </button>
    </>
  );
  const shownDetail = a
    ? { title: a.name, line: [a.kind.toLowerCase() === a.name.toLowerCase() ? '' : a.kind, a.room, [a.make, a.model].filter(Boolean).join(' ')].filter(Boolean).join(' · '), back: { section: 'appliances', label: 'Appliances' }, badge: a.status !== 'In use' ? <Pill tone={a.status === 'Needs repair' ? 'warn' : 'none'}>{a.status}</Pill> : undefined }
    : j
      ? { title: j.name, line: [jobWords(j, m!.today), j.every, j.appliance || j.room].filter(Boolean).join(' · '), back: { section: 'maintenance', label: 'Maintenance' }, badge: <Pill tone={jobTone(j)}>{j.state}</Pill> }
      : detail && m
        ? { title: 'Not found', back: { section: here, label: here === 'maintenance' ? 'Maintenance' : 'Appliances' } }
        : null;
  const empty = m && !m.homes.length && !m.appliances.length && !m.jobs.length;
  return (
    <WithRecords ctx={ctx}>
      <WorkShell tab={tab} module={HOUSE} sections={sections} here={here} actions={actions} more={more} detail={shownDetail} sharePath={a?.path ?? j?.path}>
        <div className="pm pm-house">
          {error ? (
            <p className="rm-failed">{error}</p>
          ) : !m ? (
            <div className="view-loading" />
          ) : detail ? (
            a ? <AppliancePage a={a} m={m} canEdit={canEdit} /> : j ? <JobPage j={j} m={m} canEdit={canEdit} /> : <EmptyState icon="home" title="That isn’t here any more" line="It may have been renamed, moved or taken out." action={{ label: 'Back', icon: 'back', run: () => openModule(MOD, here) }} />
          ) : empty && section === 'overview' ? (
            <EmptyState icon="home" title="Your home, its appliances and upkeep" line="Add your home for its rooms, utilities and network notes; appliances with their manuals and warranties; and the jobs that come round, to be told when each is due." action={{ label: 'Add your home', icon: 'plus', run: () => newHome(), disabled: !canEdit }} also={{ label: 'Add an appliance', icon: 'bolt', run: () => newAppliance(m), disabled: !canEdit }} />
          ) : section === 'overview' ? (
            <Overview m={m} canEdit={canEdit} />
          ) : section === 'house' ? (
            <HousePart m={m} canEdit={canEdit} />
          ) : section === 'appliances' ? (
            <div className="rm-overview">
              {m.appliances.length ? (
                <ul className="pm-cards">
                  {m.appliances.map((x) => (
                    <ApplianceCard key={x.path} a={x} />
                  ))}
                </ul>
              ) : (
                <EmptyState size="panel" icon="bolt" title="No appliances yet" line="Add the fridge, the washing machine and the rest with their warranties and manuals." action={{ label: 'New appliance', icon: 'plus', run: () => newAppliance(m), disabled: !canEdit }} />
              )}
              {m.appliances.length > 0 && <WorkViews module={MOD} section="appliances" made={houseSectionViews('appliances')} records={records} />}
            </div>
          ) : section === 'maintenance' ? (
            <div className="rm-overview">
              {m.jobs.length ? (
                JOB_GROUPS.map((g) => {
                  const list = m.jobs.filter((x) => x.state === g);
                  if (!list.length) return null;
                  return (
                    <Card key={g} id={`g-${g}`} title={g} count={list.length}>
                      <ul className="rm-rows">
                        {list.map((x) => (
                          <JobRow key={x.path} j={x} m={m} canEdit={canEdit} />
                        ))}
                      </ul>
                    </Card>
                  );
                })
              ) : (
                <EmptyState size="panel" icon="task" title="No maintenance jobs yet" line="Add the jobs that come round to be told when each is due." action={{ label: 'New job', icon: 'plus', run: () => newJob(m), disabled: !canEdit }} />
              )}
              {m.jobs.length > 0 && <WorkViews module={MOD} section="maintenance" made={houseSectionViews('maintenance')} records={records} />}
            </div>
          ) : section === 'manuals' ? (
            <Manuals m={m} canEdit={canEdit} />
          ) : (
            <WorkViews module={MOD} section={section} made={houseSectionViews(section)} records={records} />
          )}
        </div>
      </WorkShell>
    </WithRecords>
  );
}

// ── The 8.7 page (30 Oct 2026): the new overview and appliance page, the rest as before ──────────────────────────

export function HousePage({ tab }: { tab: W.TabState }) {
  const place = housePlace(tab);
  if (place === 'overview') return <HouseOverview tab={tab} />;
  if (place === 'appliance') { const path = appliancePathOf(tab); if (path) return <ApplianceDetail path={path} />; }
  if (place === 'classic') { const suffix = (partOfTab(tab) ?? '').startsWith('classic:') ? (partOfTab(tab) ?? '').slice(8) : 'overview'; return <HouseClassic tab={{ ...tab, path: `module:house#${suffix}` }} />; }
  return <HouseClassic tab={tab} />;
}

// ── Today ────────────────────────────────────────────────────────────────────────────────────────────────────────────

export function HouseToday() {
  const modules = useModules();
  const jobsOn = partOn(modules, MOD, 'maintenance');
  const warrOn = partOn(modules, MOD, 'warranties');
  const { data: m } = useWork<HouseView>(MOD, 'model', [], jobsOn || warrOn);
  const canEdit = useApp((s) => s.canEdit);
  if (!m) return null;
  const jobs = jobsOn ? m.due.filter((j) => (j.days ?? 99) <= 7) : [];
  const warr = warrOn ? m.warranties.filter((a) => a.warrantyDays !== null && a.warrantyDays >= 0 && a.warrantyDays <= 30) : [];
  if (!jobs.length && !warr.length) return null;
  return (
    <section className="td-section rm-today pm-today" data-section="house" aria-labelledby="td-h-house">
      <header className="td-section-head">
        <h2 id="td-h-house">
          House
          <span className="td-count">{jobs.length + warr.length}</span>
        </h2>
        <button type="button" className="td-section-link" onClick={() => openModule(MOD)}>
          <Icon name="home" size={13} /> House
        </button>
      </header>
      <ul className="rm-today-rows">
        {jobs.map((j) => (
          <li key={j.path} className={`rm-today-row${j.state === 'Overdue' ? ' is-late' : ''}`}>
            <button type="button" className="rm-today-main" onClick={() => openJob(j.path)}>
              <span className="rm-today-name">{j.name}</span>
              <span className="rm-today-sub">{[jobWords(j, m.today), j.lastDone && `last done ${dayText(j.lastDone)}`].filter(Boolean).join(' · ')}</span>
            </button>
            <button type="button" className="button small" disabled={!canEdit} onClick={() => markDone(j, m, true)} title="Done today: its next day moves on">
              <Icon name="check" size={12} /> Done
            </button>
          </li>
        ))}
        {warr.map((a) => (
          <li key={a.path} className="rm-today-row is-change">
            <button type="button" className="rm-today-main" onClick={() => openAppliance(a.path)}>
              <span className="rm-today-name">{a.name}</span>
              <span className="rm-today-sub">{[warrantyWords(a, m.today), a.manuals.length ? fileName(a.manuals[0]) : ''].filter(Boolean).join(' · ')}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
