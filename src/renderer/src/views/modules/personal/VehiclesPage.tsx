// Vehicles' page (Wave 7 part a; src/shared/vehicles.ts, src/main/personal/vehicles.ts). Made of the work modules'
// shared blocks: an Overview of what is due (rego, insurance, servicing, each with its own action) and every vehicle as a
// card with its last fill and fuel use; Vehicles, Fuel, Service and Reminders as record views anyone can change; and each
// vehicle's own page ("vehicle:<path>"): its fuel use as a line, its fuel log and service history changed cell by cell,
// what is due with Renewed and Service done, its details and its papers. Everything shown changes where it is.

import { useMemo, useState } from 'react';
import { partOn } from '../../../../../shared/life-modules';
import { FUEL_TYPES, VEHICLE_KINDS, VEHICLE_STATUSES, VEHICLES } from '../../../../../shared/personal-modules';
import { addToDay } from '../../../../../shared/personal-records';
import { plural } from '../../../../../shared/words';
import { distanceByYear, vehicleRecords, vehicleSectionViews, VEHICLE_EDITABLE, type Due, type DueItem, type Vehicle, type VehiclesModel } from '../../../../../shared/vehicles';
import type { WsRecord } from '../../../../../shared/workspace-records';
import { EmptyState } from '../../../components/EmptyState';
import { Icon, type IconName } from '../../../components/Icon';
import { openMenu, type MenuItem } from '../../../components/Menu';
import { fileUrl } from '../../../lib/resolve';
import * as A from '../../../state/actions';
import { openModule, partOfTab, useModules, modulesNow } from '../../../state/modules';
import { VehicleDetail, VehiclesOverview, vehiclePathOf, vehiclesPlace } from '../w3b/Vehicles87';
import { useApp } from '../../../state/store';
import { useWork, workDid } from '../../../state/workModules';
import type * as W from '../../../state/workspace';
import { openRecordForm, valueWords } from '../RecordForm';
import { Card, dayText, openDetail, Pill, placeOf, Tile, useWorkCtx, WithRecords, WorkShell, WorkViews } from '../work/WorkShell';
import { vehiclesNeeds } from '../../../../../shared/module-purpose';
import { NeedsYou } from '../NeedsYou';
import { afterLead, leadKeys } from '../needsLead';
import { caller, EditTable, Fact, FilesList, Inline, keepFiles, LineChart, money, MonthBars } from './PersonalParts';

export type VehiclesView = VehiclesModel & { folder: string; currency: string; serviceMonths: number; serviceKm: number };

const MOD = 'vehicles';
const call = caller(MOD);
export const openVehicle = (rel: string) => openDetail(MOD, 'vehicle', rel);
const KIND_ICON: Record<string, IconName> = { Car: 'car', SUV: 'car', Ute: 'car', Van: 'car', Truck: 'car', Motorbike: 'car', Boat: 'globe', Trailer: 'layers', Caravan: 'home' };
const SERVICE_KINDS = ['Logbook service', 'Minor service', 'Major service', 'Tyres', 'Brakes', 'Battery', 'Wheel alignment', 'Repair', 'Inspection'];
const dueTone = (d: Pick<Due, 'late' | 'soon'>) => (d.late ? 'bad' : d.soon ? 'warn' : 'ok');
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
/** "in 12 days", "3 days overdue", "in 500 km", "340 km overdue": what is nearer, by day or by km. */
export function shortDue(d: Due): string {
  const byKm = d.kmLeft !== null && (d.days === null || (d.kmLeft < 0 ? d.days >= 0 : d.days >= 0 && d.kmLeft / 50 < d.days));
  if (byKm) return d.kmLeft! < 0 ? `${Math.abs(d.kmLeft!).toLocaleString('en-AU')} km overdue` : `in ${d.kmLeft!.toLocaleString('en-AU')} km`;
  if (d.days === null) return '';
  return d.days < 0 ? `${-d.days} ${d.days === -1 ? 'day' : 'days'} overdue` : d.days === 0 ? 'today' : d.days === 1 ? 'tomorrow' : `in ${d.days} days`;
}

// ── Doing things ─────────────────────────────────────────────────────────────────────────────────────────────────────

export async function saveProp(v: Vehicle, field: string, value: string): Promise<boolean> {
  return (await workDid(call<string | null>('set-field', { kind: 'vehicle', path: v.path, field, value }).then((said) => ({ said })), (x) => x.said ?? '')) !== null;
}
export async function saveCell(v: Vehicle, kind: 'fuel' | 'servicing' | 'trip', row: number, title: string, field: string, value: string): Promise<boolean> {
  return (await workDid(call<string | null>('set-field', { kind, path: v.path, field, value, ref: { row }, title }).then((said) => ({ said })), (x) => x.said ?? '')) !== null;
}

export function newVehicle(): void {
  openRecordForm({
    title: 'New vehicle',
    icon: 'car',
    line: 'A car, bike, van or trailer. Its rego, insurance and service come to Today before they are due.',
    ok: 'Add the vehicle',
    fields: [
      { key: 'kind', label: 'Kind', kind: 'choice', options: [...VEHICLE_KINDS], value: 'Car' },
      { key: 'fuel', label: 'Fuel', kind: 'choice', options: [...FUEL_TYPES], value: 'Petrol' },
      { key: 'make', label: 'Make', kind: 'text', placeholder: 'Roadster' },
      { key: 'model', label: 'Model', kind: 'text', placeholder: 'Wagon' },
      { key: 'year', label: 'Year', kind: 'number', placeholder: '2021' },
      { key: 'rego', label: 'Rego', kind: 'text', placeholder: 'ABC123' },
      { key: 'name', label: 'Name (optional)', kind: 'text', wide: true, hint: 'What you call it (“The wagon”). Its year, make and model when left empty.' },
      { key: 'odometer', label: 'Odometer now (km)', kind: 'number' },
      { key: 'rego_due', label: 'Rego due', kind: 'date' },
      { key: 'insurer', label: 'Insurer', kind: 'text' },
      { key: 'insurance_due', label: 'Insurance due', kind: 'date' },
      { key: 'service_due', label: 'Next service', kind: 'date' },
      { key: 'service_km', label: 'Next service at (km)', kind: 'number' },
    ],
    submit: async (v) => {
      const input = Object.fromEntries(['kind', 'fuel', 'make', 'model', 'year', 'rego', 'name', 'odometer', 'rego_due', 'insurer', 'insurance_due', 'service_due', 'service_km'].map((k) => [k, valueWords(v, k)]));
      const rel = await call<string>('add-vehicle', input);
      await workDid(Promise.resolve(rel), `Added ${A.titleOf(rel)}.`, { label: 'Open', run: () => openVehicle(rel) });
    },
  });
}

export function logFill(m: VehiclesView | null, at?: Vehicle): void {
  const live = (m?.vehicles ?? []).filter((v) => v.status !== 'Sold');
  const v0 = at ?? live[0];
  if (!v0) return newVehicle();
  openRecordForm({
    title: at ? `Log a fill-up for ${at.name}` : 'Log a fill-up',
    icon: 'fuel',
    line: 'Fuel use is worked out between full tanks, so a part fill never skews it.',
    ok: 'Log it',
    fields: [
      ...(at ? [] : [{ key: 'vehicle', label: 'Vehicle', kind: 'choice' as const, options: live.map((v) => v.name), value: v0.name, wide: true }]),
      { key: 'date', label: 'Date', kind: 'date', value: m?.today ?? '' },
      { key: 'odometer', label: 'Odometer (km)', kind: 'number', placeholder: v0.odometer !== null ? String(v0.odometer) : '' },
      { key: 'litres', label: v0.unit === 'kWh' ? 'kWh' : 'Litres', kind: 'number' },
      { key: 'cost', label: 'Cost', kind: 'money' },
      { key: 'full', label: 'Tank', kind: 'segment', options: ['Full', 'Part fill'], value: 'Full' },
      { key: 'station', label: 'Station', kind: 'text' },
    ],
    submit: async (vals) => {
      const v = at ?? live.find((x) => x.name === valueWords(vals, 'vehicle')) ?? v0;
      await workDid(call<string>('add-fill', v.path, { date: valueWords(vals, 'date'), odometer: valueWords(vals, 'odometer'), litres: valueWords(vals, 'litres'), cost: valueWords(vals, 'cost'), full: valueWords(vals, 'full') !== 'Part fill', station: valueWords(vals, 'station') }));
    },
  });
}

export function logTrip(m: VehiclesView | null, v: Vehicle): void {
  openRecordForm({
    title: `Log a trip for ${v.name}`,
    icon: 'car',
    line: 'Trips are added up per financial year (July to June), ready for tax time.',
    ok: 'Log it',
    fields: [
      { key: 'date', label: 'Date', kind: 'date', value: m?.today ?? '' },
      { key: 'reason', label: 'Reason', kind: 'text', wide: true, placeholder: 'Client visit' },
      { key: 'from', label: 'From', kind: 'text' },
      { key: 'to', label: 'To', kind: 'text' },
      { key: 'km', label: 'Kilometres', kind: 'number', required: true },
    ],
    submit: async (vals) => {
      await workDid(call<string>('add-trip', v.path, { date: valueWords(vals, 'date'), reason: valueWords(vals, 'reason'), from: valueWords(vals, 'from'), to: valueWords(vals, 'to'), km: valueWords(vals, 'km') }));
    },
  });
}

export async function recordService(m: VehiclesView | null, v: Vehicle): Promise<void> {
  const next = await call<{ date: string; km: number | null }>('next-service', m?.today ?? '', v.odometer).catch(() => null);
  openRecordForm({
    title: `Record a service for ${v.name}`,
    icon: 'settings',
    line: `The next one is set from it: ${m?.serviceMonths ?? 12} months and ${(m?.serviceKm ?? 10000).toLocaleString('en-AU')} km on, unless you change it.`,
    ok: 'Record it',
    fields: [
      { key: 'what', label: 'What was done', kind: 'choice', options: SERVICE_KINDS, value: 'Logbook service', own: true, wide: true },
      { key: 'date', label: 'Date', kind: 'date', value: m?.today ?? '' },
      { key: 'odometer', label: 'Odometer (km)', kind: 'number', value: v.odometer !== null ? String(v.odometer) : '' },
      { key: 'where', label: 'Where', kind: 'text', placeholder: 'The garage' },
      { key: 'cost', label: 'Cost', kind: 'money' },
      { key: 'next_due', label: 'Next service', kind: 'date', value: next?.date ?? '' },
      { key: 'next_km', label: 'Next service at (km)', kind: 'number', value: next?.km ? String(next.km) : '' },
    ],
    submit: async (vals) => {
      await workDid(call<string>('add-service', v.path, Object.fromEntries(['what', 'date', 'odometer', 'where', 'cost', 'next_due', 'next_km'].map((k) => [k, valueWords(vals, k)]))));
    },
  });
}

export function renewed(v: Vehicle, what: 'rego' | 'insurance', today: string): void {
  const now = what === 'rego' ? v.regoDue : v.insuranceDue;
  const from = now && now > today ? now : today;
  openRecordForm({
    title: `${what === 'rego' ? 'Rego' : 'Insurance'} renewed for ${v.name}`,
    icon: 'check',
    line: 'The day it now runs to. The reminder moves on to it.',
    ok: 'Save it',
    fields: [{ key: 'until', label: 'Runs to', kind: 'date', required: true, value: addToDay(from, { years: 1 }) }, ...(what === 'insurance' ? [{ key: 'insurer', label: 'Insurer', kind: 'text' as const, value: v.insurer }] : [])],
    submit: async (vals) => {
      await workDid(call<string>('renewed', v.path, what, valueWords(vals, 'until')));
      if (what === 'insurance' && valueWords(vals, 'insurer') !== v.insurer) await saveProp(v, 'insurer', valueWords(vals, 'insurer'));
    },
  });
}

export function vehiclesOptions(m: VehiclesView): void {
  openRecordForm({
    title: 'Cars options',
    icon: 'settings',
    ok: 'Save',
    fields: [
      { key: 'remind', label: 'Say rego, insurance or a service is due this many days ahead', kind: 'number', value: String(m.remindDays), hint: 'On Today, in the bell and on the Overview. 30 unless you change it.' },
      { key: 'months', label: 'Months between services', kind: 'number', value: String(m.serviceMonths) },
      { key: 'km', label: 'Kilometres between services', kind: 'number', value: String(m.serviceKm) },
      { key: 'currency', label: 'Currency', kind: 'text', value: m.currency, hint: 'Three letters, like AUD or NZD. Money’s unless set here.' },
    ],
    submit: async (v) => {
      const n = (k: string) => Math.max(0, Math.round(Number(valueWords(v, k)) || 0));
      await workDid(call('options', { remindDays: Math.min(365, n('remind')), serviceMonths: n('months') || 12, serviceKm: n('km'), currency: valueWords(v, 'currency').toUpperCase() }), 'Saved the Cars options.');
    },
  });
}

function dueAction(d: Due, v: Vehicle, m: VehiclesView, canEdit: boolean) {
  return d.what === 'service' ? (
    <button type="button" className="button small" disabled={!canEdit} onClick={() => void recordService(m, v)}>
      <Icon name="check" size={12} /> Service done
    </button>
  ) : (
    <button type="button" className="button small" disabled={!canEdit} onClick={() => renewed(v, d.what as 'rego' | 'insurance', m.today)}>
      <Icon name="check" size={12} /> Renewed
    </button>
  );
}

export function vehicleMenu(v: Vehicle, m: VehiclesView, canEdit: boolean): MenuItem[] {
  return [
    { label: 'Open', icon: 'eye', run: () => openVehicle(v.path) },
    { separator: true },
    { label: 'Log a fill-up…', icon: 'fuel', disabled: !canEdit || !partOn(modulesNow(), MOD, 'fuel'), run: () => logFill(m, v) },
    { label: 'Record a service…', icon: 'settings', disabled: !canEdit, run: () => void recordService(m, v) },
    { label: 'Rego renewed…', icon: 'check', disabled: !canEdit, run: () => renewed(v, 'rego', m.today) },
    { label: 'Insurance renewed…', icon: 'check', disabled: !canEdit, run: () => renewed(v, 'insurance', m.today) },
    { label: 'Keep papers or photos with it…', icon: 'paperclip', disabled: !canEdit, run: () => void keepFiles(MOD, v.path, v.name) },
    { separator: true },
    { label: 'Open its note', icon: 'notes', run: () => A.openPath(v.path, { where: 'tab' }) },
  ];
}

// ── Overview ─────────────────────────────────────────────────────────────────────────────────────────────────────────

function TrendWords({ v }: { v: Vehicle }) {
  if (v.per100 === null) return <span className="pm-faint">No fuel use yet</span>;
  return (
    <span className={`pm-trend is-${v.trend ?? 'steady'}`}>
      {v.per100} {v.unit}/100 km
      {v.trend && v.trend !== 'steady' && <span className="pm-trend-word">{v.trend === 'better' ? 'using less' : 'using more'}</span>}
    </span>
  );
}

function VehicleCard({ v, m }: { v: Vehicle; m: VehiclesView }) {
  const photo = v.photos[0];
  const shown = v.dues.filter((d) => d.late || d.soon);
  return (
    <li className={`pm-card${v.status === 'Sold' ? ' is-gone' : ''}`}>
      <button type="button" className="pm-card-main" onClick={() => openVehicle(v.path)}>
        <span className="pm-card-pic" aria-hidden="true">
          {photo ? <img src={fileUrl(photo)} alt="" loading="lazy" /> : <Icon name={KIND_ICON[v.kind] ?? 'car'} size={20} />}
        </span>
        <span className="pm-card-words">
          <span className="pm-card-name">
            {v.name}
            {v.rego && <span className="pm-plate">{v.rego}</span>}
          </span>
          <span className="pm-card-sub">{[v.year, v.make, v.model].filter(Boolean).join(' ') || v.kind} · {v.fuel}</span>
        </span>
      </button>
      <div className="pm-card-stats">
        {v.status !== 'Active' && <Pill tone="none">{v.status}</Pill>}
        {shown.map((d) => (
          <Pill key={d.what} tone={dueTone(d)} title={d.words}>
            {d.label} {shortDue(d)}
          </Pill>
        ))}
        {!shown.length && v.status !== 'Sold' && <span className="pm-ok">Nothing due</span>}
        <span className="pm-card-gap" />
        <TrendWords v={v} />
      </div>
      {v.lastFill && (
        <div className="pm-card-foot">
          Last fill {v.lastFill.date ? dayText(v.lastFill.date) : ''}
          {v.lastFill.litres !== null ? ` · ${v.lastFill.litres} ${v.unit}` : ''}
          {v.lastFill.cost !== null ? ` · ${money(v.lastFill.cost, m.currency)}` : ''}
          {v.odometer !== null ? ` · ${v.odometer.toLocaleString('en-AU')} km` : ''}
        </div>
      )}
    </li>
  );
}

function DueRow({ d, m, canEdit }: { d: DueItem; m: VehiclesView; canEdit: boolean }) {
  return (
    <li className={`rm-row${d.late ? ' is-late' : ' is-soon'}`}>
      <button type="button" className="rm-row-main" onClick={() => openVehicle(d.vehicle.path)}>
        <span className="rm-row-icon" aria-hidden="true">
          <Icon name={d.what === 'service' ? 'settings' : d.what === 'rego' ? 'idcard' : 'lock'} size={14} />
        </span>
        <span className="rm-row-words">
          <span className="rm-row-name">
            {d.vehicle.name} <span className="pm-faint">· {d.label}</span>
          </span>
          <span className="rm-row-sub">{[d.words, d.what === 'insurance' && d.vehicle.insurer, d.vehicle.rego].filter(Boolean).join(' · ')}</span>
        </span>
      </button>
      <span className="rm-row-end">
        {dueAction(d, d.vehicle, m, canEdit)}
        <button type="button" className="icon-button small" aria-label={`More for ${d.vehicle.name}`} onClick={(e) => openMenu(e.currentTarget, vehicleMenu(d.vehicle, m, canEdit))}>
          <Icon name="more" size={13} />
        </button>
      </span>
    </li>
  );
}

function Overview({ m, canEdit }: { m: VehiclesView; canEdit: boolean }) {
  const modules = useModules();
  const reminders = partOn(modules, MOD, 'reminders');
  const fuelOn = partOn(modules, MOD, 'fuel');
  const live = m.vehicles.filter((v) => v.status !== 'Sold');
  const late = m.due.filter((d) => d.late).length;
  const spend = live.reduce((a, v) => a + v.spend12, 0);
  const months = live.length ? live[0].months.map((x, i) => ({ month: x.month, value: live.reduce((a, v) => a + (v.months[i]?.cost ?? 0), 0) })) : [];
  const thisMonth = months[months.length - 1]?.value ?? 0;
  const needsCards = vehiclesNeeds(m.due.map((d) => ({ vehicle: d.vehicle.name, path: d.vehicle.path, what: d.label, date: d.date, detail: d.words })), m.today);
  // Coming up starts after Needs you: a due item already shown there is not repeated below it.
  const comingUp = afterLead(m.due, leadKeys(needsCards, m.today), (d) => [`due:${d.vehicle.path}:${d.label}`, `${d.vehicle.name}: ${d.label.toLowerCase()}`]);
  return (
    <div className="rm-overview">
      {reminders && <NeedsYou cards={needsCards} today={m.today} canEdit={canEdit} onAction={(c) => { if (c.ref) openVehicle(c.ref); }} />}
      <div className="rm-tiles">
        <Tile icon="car" label="Cars" value={String(live.length)} sub={[...new Set(live.map((v) => v.kind))].join(', ') || 'None yet'} onClick={() => openModule(MOD, 'vehicles')} />
        {reminders && <Tile icon="bell" label="Due soon" value={String(m.due.length)} sub={late ? `${late} overdue` : m.due.length ? `In the next ${plural(m.remindDays, 'day')}` : 'Nothing due'} tone={late ? 'bad' : m.due.length ? 'warn' : 'ok'} onClick={() => openModule(MOD, 'reminders')} />}
        {fuelOn && <Tile icon="fuel" label="Fuel this month" value={money(thisMonth, m.currency, false)} sub={`${money(spend, m.currency, false)} over 12 months`} onClick={() => openModule(MOD, 'fuel')} />}
        {fuelOn && live.length === 1 && <Tile icon="chart" label="Fuel use" value={live[0].per100 !== null ? `${live[0].per100}` : ''} sub={live[0].per100 !== null ? `${live[0].unit}/100 km${live[0].trend && live[0].trend !== 'steady' ? `, ${live[0].trend === 'better' ? 'using less' : 'using more'}` : ''}` : 'After two full tanks'} onClick={() => openVehicle(live[0].path)} />}
      </div>
      {(reminders || fuelOn) && (
        <div className="rm-cols">
          {reminders && (comingUp.length > 0 || !m.due.length) && (
            <Card id="due" title="Coming up" count={comingUp.length} link={{ label: 'Reminders', run: () => openModule(MOD, 'reminders') }}>
              {comingUp.length ? (
                <ul className="rm-rows">
                  {comingUp.slice(0, 8).map((d) => (
                    <DueRow key={`${d.vehicle.path}:${d.what}`} d={d} m={m} canEdit={canEdit} />
                  ))}
                </ul>
              ) : (
                <p className="rm-none">Nothing is due in the next {m.remindDays} days.</p>
              )}
            </Card>
          )}
          {fuelOn && (
            <Card id="spend" title="Fuel spend by month" link={{ label: 'Fuel', run: () => openModule(MOD, 'fuel') }}>
              {spend > 0 ? <MonthBars months={months} cur={m.currency} label="Fuel spend, the last twelve months" /> : <p className="rm-none">Log a fill-up to see what fuel costs each month.</p>}
            </Card>
          )}
        </div>
      )}
      <Card id="vehicles" title="Cars" count={m.vehicles.length} link={{ label: 'All vehicles', run: () => openModule(MOD, 'vehicles') }}>
        <ul className="pm-cards">
          {m.vehicles.map((v) => (
            <VehicleCard key={v.path} v={v} m={m} />
          ))}
        </ul>
      </Card>
    </div>
  );
}

// ── A vehicle's page ─────────────────────────────────────────────────────────────────────────────────────────────────

function VehiclePage({ v, m, canEdit }: { v: Vehicle; m: VehiclesView; canEdit: boolean }) {
  const modules = useModules();
  const fuelOn = partOn(modules, MOD, 'fuel');
  const points = v.fills
    .filter((f) => f.per100 !== null && f.date)
    .sort((a, b) => a.date!.localeCompare(b.date!))
    .map((f) => ({ x: f.date!, y: f.per100! }));
  const fills = [...v.fills].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || (b.odometer ?? 0) - (a.odometer ?? 0));
  const services = [...v.services].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
  const lastPrice = fills.find((f) => f.price !== null)?.price ?? null;
  const prop = (field: string) => (x: string) => saveProp(v, field, x);
  const dueOf = (what: 'rego' | 'insurance' | 'service') => v.dues.find((d) => d.what === what);
  const DueLine = ({ what, label, field }: { what: 'rego' | 'insurance' | 'service'; label: string; field: string }) => {
    const d = dueOf(what);
    const value = what === 'rego' ? v.regoDue : what === 'insurance' ? v.insuranceDue : v.serviceDue;
    return (
      <li className={`pm-due${d?.late ? ' is-late' : d?.soon ? ' is-soon' : ''}`}>
        <span className="pm-due-label">{label}</span>
        <span className="pm-due-day">
          <Inline value={value ?? ''} shown={value ? dayText(value) : undefined} label={`${label} due`} kind="date" placeholder="Add the day" canEdit={canEdit} onSave={prop(field)} />
          {d && (d.late || d.soon) && <span className="pm-due-words">{shortDue(d)}</span>}
        </span>
        {d && (d.late || d.soon) && <span className="pm-due-act">{dueAction(d, v, m, canEdit)}</span>}
      </li>
    );
  };
  return (
    <div className="pm-reg">
      <div className="pm-reg-main">
        {fuelOn && (
          <Card
            id="fuel"
            className="pm-c-fuel"
            title="Fuel"
            count={v.fills.length}
            actions={
              canEdit ? (
                <button type="button" className="text-button" onClick={() => logFill(m, v)}>
                  <Icon name="plus" size={12} /> Log a fill-up
                </button>
              ) : undefined
            }
          >
            <div className="pm-stats">
              <span>
                <strong>{v.per100 !== null ? v.per100 : ''}</strong> {v.unit}/100 km
              </span>
              <span>
                <strong>{v.costPer100 !== null ? money(v.costPer100, m.currency) : ''}</strong> per 100 km
              </span>
              <span>
                <strong>{money(v.spend12, m.currency, false)}</strong> last 12 months
              </span>
              {lastPrice !== null && (
                <span>
                  <strong>{money(lastPrice, m.currency)}</strong> per {v.unit === 'kWh' ? 'kWh' : 'litre'} last fill
                </span>
              )}
            </div>
            <LineChart points={points.slice(-24)} unit={`${v.unit}/100 km`} label={`${v.name}’s fuel use between full tanks`} />
            {fills.length ? (
              <EditTable
                label={`${v.name}’s fuel log`}
                rows={fills.map((f) => ({ row: f.row, values: { date: f.date ?? f.dateWords, odometer: f.odometer !== null ? String(f.odometer) : '', litres: f.litres !== null ? String(f.litres) : '', cost: f.cost !== null ? String(f.cost) : '', price: f.price !== null ? String(f.price) : '', full: f.full ? 'Yes' : 'No', station: f.station, per100: f.per100 !== null ? String(f.per100) : '' } }))}
                cols={[
                  { key: 'date', label: 'Date', kind: 'date', strong: true },
                  { key: 'odometer', label: 'Odometer', kind: 'number', num: true, shown: (x) => (x ? Number(x).toLocaleString('en-AU') : '') },
                  { key: 'litres', label: v.unit === 'kWh' ? 'kWh' : 'Litres', kind: 'number', num: true },
                  { key: 'cost', label: 'Cost', kind: 'money', num: true, shown: (x) => (x ? money(Number(x), m.currency) : '') },
                  { key: 'price', label: `Per ${v.unit === 'kWh' ? 'kWh' : 'litre'}`, kind: 'readonly', num: true, shown: (x) => (x ? money(Number(x), m.currency) : '') },
                  { key: 'full', label: 'Full', kind: 'choice', options: ['Yes', 'No'] },
                  { key: 'per100', label: `${v.unit}/100 km`, kind: 'readonly', num: true, shown: (x) => x || '' },
                  { key: 'station', label: 'Station', kind: 'text' },
                ]}
                title="date"
                canEdit={canEdit}
                onSave={(row, title, field, value) => saveCell(v, 'fuel', row, title, field, value)}
                onRemove={(row, title) => void workDid(call<string>('remove-row', v.path, 'fuel', row, title))}
              />
            ) : (
              <p className="rm-none">No fill-ups yet. Log each one with the odometer to see fuel use between full tanks.</p>
            )}
          </Card>
        )}
        <Card
          id="service"
          className="pm-c-service"
          title="Service history"
          count={v.services.length}
          actions={
            canEdit ? (
              <button type="button" className="text-button" onClick={() => void recordService(m, v)}>
                <Icon name="plus" size={12} /> Record a service
              </button>
            ) : undefined
          }
        >
          {services.length ? (
            <EditTable
              label={`${v.name}’s service history`}
              rows={services.map((s) => ({ row: s.row, values: { date: s.date ?? s.dateWords, odometer: s.odometer !== null ? String(s.odometer) : '', what: s.what, garage: s.where, cost: s.cost !== null ? String(s.cost) : '' } }))}
              cols={[
                { key: 'date', label: 'Date', kind: 'date' },
                { key: 'what', label: 'What', kind: 'text', strong: true },
                { key: 'odometer', label: 'Odometer', kind: 'number', num: true, shown: (x) => (x ? Number(x).toLocaleString('en-AU') : '') },
                { key: 'garage', label: 'Where', kind: 'text' },
                { key: 'cost', label: 'Cost', kind: 'money', num: true, shown: (x) => (x ? money(Number(x), m.currency) : '') },
              ]}
              title="what"
              canEdit={canEdit}
              onSave={(row, title, field, value) => saveCell(v, 'servicing', row, title, field, value)}
              onRemove={(row, title) => void workDid(call<string>('remove-row', v.path, 'service', row, title))}
            />
          ) : (
            <p className="rm-none">No services recorded yet. Record one to set when the next is due.</p>
          )}
        </Card>
        <Card
          id="distance"
          title="Distance log"
          count={v.trips.length}
          actions={
            canEdit ? (
              <button type="button" className="text-button" onClick={() => logTrip(m, v)}>
                <Icon name="plus" size={12} /> Log a trip
              </button>
            ) : undefined
          }
        >
          {v.trips.length ? (
            <>
              <div className="pm-stats">
                {distanceByYear(v.trips).map((y) => (
                  <span key={y.year}>
                    <strong>{y.km.toLocaleString('en-AU')} km</strong> in {y.year}
                  </span>
                ))}
              </div>
              <EditTable
                label={`${v.name}’s distance log`}
                rows={[...v.trips].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '')).map((t) => ({ row: t.row, values: { date: t.date ?? t.dateWords, reason: t.reason, from: t.from, to: t.to, km: t.km !== null ? String(t.km) : '' } }))}
                cols={[
                  { key: 'date', label: 'Date', kind: 'date', strong: true },
                  { key: 'reason', label: 'Reason', kind: 'text' },
                  { key: 'from', label: 'From', kind: 'text' },
                  { key: 'to', label: 'To', kind: 'text' },
                  { key: 'km', label: 'Km', kind: 'number', num: true, shown: (x) => (x ? Number(x).toLocaleString('en-AU') : '') },
                ]}
                title="date"
                canEdit={canEdit}
                onSave={(row, title, field, value) => saveCell(v, 'trip', row, title, field, value)}
                onRemove={(row, title) => void workDid(call<string>('remove-row', v.path, 'trips', row, title))}
              />
            </>
          ) : (
            <p className="rm-none">No trips logged yet. Log each work trip with its kilometres and the year adds itself up for tax time.</p>
          )}
        </Card>
      </div>
      <aside className="pm-reg-side">
        <Card id="dues" className="pm-c-dues" title="Due">
          <ul className="pm-dues">
            <DueLine what="rego" label="Rego" field="rego_due" />
            <DueLine what="insurance" label="Insurance" field="insurance_due" />
            <DueLine what="service" label="Service" field="service_due" />
          </ul>
          <div className="pm-facts pm-facts-tight">
            <Fact label="Service at">
              <Inline value={v.serviceKm !== null ? String(v.serviceKm) : ''} shown={v.serviceKm !== null ? `${v.serviceKm.toLocaleString('en-AU')} km` : undefined} label="Next service at (km)" kind="number" placeholder="Add the km" canEdit={canEdit} onSave={prop('service_km')} />
            </Fact>
            <Fact label="Odometer">
              <span className="pm-plain">{v.odometer !== null ? `${v.odometer.toLocaleString('en-AU')} km` : ''}</span>
            </Fact>
          </div>
        </Card>
        <Card id="details" className="pm-c-details" title="Details">
          <div className="pm-facts">
            <Fact label="Kind">
              <Inline value={v.kind} label="Kind" kind="choice" options={[...VEHICLE_KINDS]} canEdit={canEdit} onSave={prop('vehicle_kind')} />
            </Fact>
            <Fact label="Make">
              <Inline value={v.make} label="Make" canEdit={canEdit} onSave={prop('make')} />
            </Fact>
            <Fact label="Model">
              <Inline value={v.model} label="Model" canEdit={canEdit} onSave={prop('model')} />
            </Fact>
            <Fact label="Year">
              <Inline value={v.year !== null ? String(v.year) : ''} label="Year" kind="number" canEdit={canEdit} onSave={prop('year')} />
            </Fact>
            <Fact label="Rego">
              <Inline value={v.rego} label="Rego" canEdit={canEdit} onSave={prop('rego')} />
            </Fact>
            <Fact label="Insurer">
              <Inline value={v.insurer} label="Insurer" canEdit={canEdit} onSave={prop('insurer')} />
            </Fact>
            <Fact label="Fuel">
              <Inline value={v.fuel} label="Fuel" kind="choice" options={[...FUEL_TYPES]} canEdit={canEdit} onSave={prop('fuel_type')} />
            </Fact>
            <Fact label="VIN">
              <Inline value={v.vin} label="VIN" canEdit={canEdit} onSave={prop('vin')} />
            </Fact>
            <Fact label="Status">
              <Inline value={v.status} label="Status" kind="choice" options={[...VEHICLE_STATUSES]} canEdit={canEdit} onSave={prop('status')} />
            </Fact>
          </div>
        </Card>
        <Card
          id="papers"
          className="pm-c-files"
          title="Papers and photos"
          count={v.files.length}
          actions={
            canEdit ? (
              <button type="button" className="text-button" onClick={() => void keepFiles(MOD, v.path, v.name)}>
                <Icon name="plus" size={12} /> Add
              </button>
            ) : undefined
          }
        >
          <FilesList files={v.files} empty="Keep the rego papers, the insurance certificate and photos with it." />
        </Card>
      </aside>
    </div>
  );
}

// ── Fuel and Service: one vehicle at a time (fuel use is only meaningful per vehicle), or all of them ───────────────────

function FuelPart({ m, section, records, only, setOnly }: { m: VehiclesView; section: string; records: WsRecord[]; only: string | null; setOnly(v: string | null): void }) {
  const live = m.vehicles.filter((v) => v.status !== 'Sold');
  const pick = only === 'all' ? null : (m.vehicles.find((v) => v.path === only) ?? live[0] ?? null);
  const shown = pick ? records.filter((r) => r.path === pick.path) : records;
  return (
    <div className="rm-overview">
      {m.vehicles.length > 1 && (
        <div className="pm-chips" role="group" aria-label="Show a vehicle">
          {m.vehicles.map((v) => (
            <button key={v.path} type="button" className={`pm-chip${pick?.path === v.path ? ' is-on' : ''}`} aria-pressed={pick?.path === v.path} onClick={() => setOnly(v.path)}>
              {v.name} <span className="pm-chip-n">{section === 'fuel' ? v.fills.length : v.services.length}</span>
            </button>
          ))}
          <button type="button" className={`pm-chip${!pick ? ' is-on' : ''}`} aria-pressed={!pick} onClick={() => setOnly('all')}>
            All vehicles
          </button>
        </div>
      )}
      <WorkViews module={MOD} section={section} made={vehicleSectionViews(section)} records={shown} />
    </div>
  );
}

// ── The page ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export function VehiclesClassic({ tab }: { tab: W.TabState }) {
  const canEdit = useApp((s) => s.canEdit);
  const [only, setOnly] = useState<string | null>(null);
  const modules = useModules();
  const sections = VEHICLES.sections.filter((s) => (s.id !== 'fuel' || partOn(modules, MOD, 'fuel')) && (s.id !== 'reminders' || partOn(modules, MOD, 'reminders')));
  const { section, detail } = placeOf(tab, VEHICLES, sections);
  const { data: m, error } = useWork<VehiclesView>(MOD);
  const records = useMemo(() => (m ? vehicleRecords(m) : []), [m]);
  const ctx = useWorkCtx(MOD, records, {
    editable: (r) => VEHICLE_EDITABLE[r.kind] ?? [],
    open: (r: WsRecord, e) => {
      if (!r.path) return;
      if (e?.ctrlKey || e?.metaKey) return A.openPath(r.path, { where: 'tab' });
      openVehicle(r.path);
    },
  });
  const v = detail?.kind === 'vehicle' && m ? m.vehicles.find((x) => x.path === detail.key) : undefined;
  const here = detail ? 'vehicles' : section;
  const more = (): MenuItem[] => [
    { label: 'New vehicle', icon: 'car', disabled: !canEdit, run: () => newVehicle() },
    { label: 'Log a fill-up', icon: 'fuel', disabled: !canEdit || !partOn(modules, MOD, 'fuel') || !m?.vehicles.length, run: () => logFill(m, v) },
    ...(v ? ([{ separator: true }, ...vehicleMenu(v, m!, canEdit).slice(2)] as MenuItem[]) : []),
    { separator: true },
    { label: 'Cars options…', icon: 'settings', disabled: !canEdit || !m, run: () => m && vehiclesOptions(m) },
    { label: 'Show the folder', icon: 'folder', disabled: !m, run: () => m && A.revealInExplorer(m.folder) },
  ];
  const actions = v && partOn(modules, MOD, 'fuel') ? (
    <button type="button" className="sv-tool nt-new" disabled={!canEdit} onClick={() => logFill(m, v)}>
      <Icon name="fuel" size={14} /> Log a fill-up
    </button>
  ) : (
    <>
      {m && m.vehicles.length > 0 && partOn(modules, MOD, 'fuel') && (
        <button type="button" className="sv-tool" disabled={!canEdit} onClick={() => logFill(m)}>
          <Icon name="fuel" size={14} /> Log a fill-up
        </button>
      )}
      <button type="button" className="sv-tool nt-new" disabled={!canEdit} onClick={() => newVehicle()}>
        <Icon name="plus" size={14} /> New vehicle
      </button>
    </>
  );
  const shownDetail = v ? { title: v.name, line: [v.year, v.make, v.model].filter(Boolean).join(' ') + (v.rego ? ` · ${v.rego}` : '') + ` · ${v.fuel}`, back: { section: 'vehicles', label: 'Cars' }, badge: v.status !== 'Active' ? <Pill tone="none">{v.status}</Pill> : undefined } : detail && m ? { title: 'Vehicle not found', back: { section: 'vehicles', label: 'Cars' } } : null;
  return (
    <WithRecords ctx={ctx}>
      <WorkShell tab={tab} module={VEHICLES} sections={sections} here={here} actions={actions} more={more} detail={shownDetail} sharePath={v?.path}>
        <div className="pm pm-vehicles">
          {error ? (
            <p className="rm-failed">{error}</p>
          ) : !m ? (
            <div className="view-loading" />
          ) : detail ? (
            v ? <VehiclePage v={v} m={m} canEdit={canEdit} /> : <EmptyState icon="car" title="That vehicle isn’t here any more" line="It may have been renamed, moved or taken out." action={{ label: 'All vehicles', icon: 'car', run: () => openModule(MOD, 'vehicles') }} />
          ) : !m.vehicles.length ? (
            <EmptyState icon="car" title="Your vehicles, with what is due on each" line="Add a car, bike or trailer with its rego, insurance and service days to be told before each is due, and log fill-ups to see its fuel use." action={{ label: 'Add your first vehicle', icon: 'plus', run: () => newVehicle(), disabled: !canEdit }} />
          ) : section === 'overview' ? (
            <Overview m={m} canEdit={canEdit} />
          ) : section === 'vehicles' ? (
            <div className="rm-overview">
              <ul className="pm-cards">
                {m.vehicles.map((x) => (
                  <VehicleCard key={x.path} v={x} m={m} />
                ))}
              </ul>
              <WorkViews module={MOD} section="vehicles" made={vehicleSectionViews('vehicles')} records={records} />
            </div>
          ) : section === 'fuel' || section === 'service' ? (
            <FuelPart m={m} section={section} records={records} only={only} setOnly={setOnly} />
          ) : (
            <WorkViews module={MOD} section={section} made={vehicleSectionViews(section)} records={records} />
          )}
        </div>
      </WorkShell>
    </WithRecords>
  );
}

// ── The 8.7 page (30 Oct 2026): the new overview and car page, the rest as before ────────────────────────────────

export function VehiclesPage({ tab }: { tab: W.TabState }) {
  const place = vehiclesPlace(tab);
  if (place === 'overview') return <VehiclesOverview tab={tab} />;
  if (place === 'vehicle') { const path = vehiclePathOf(tab); if (path) return <VehicleDetail path={path} />; }
  if (place === 'classic') { const suffix = (partOfTab(tab) ?? '').startsWith('classic:') ? (partOfTab(tab) ?? '').slice(8) : 'overview'; return <VehiclesClassic tab={{ ...tab, path: `module:vehicles#${suffix}` }} />; }
  return <VehiclesClassic tab={tab} />;
}

// ── Today ────────────────────────────────────────────────────────────────────────────────────────────────────────────

export function VehiclesToday() {
  const modules = useModules();
  const on = partOn(modules, MOD, 'reminders');
  const { data: m } = useWork<VehiclesView>(MOD, 'model', [], on);
  if (!m || !on) return null;
  const items = m.due.filter((d) => d.late || (d.days !== null && d.days <= Math.min(m.remindDays, 14)) || (d.kmLeft !== null && d.kmLeft <= 500));
  if (!items.length) return null;
  return (
    <section className="td-section rm-today pm-today" data-section="vehicles" aria-labelledby="td-h-vehicles">
      <header className="td-section-head">
        <h2 id="td-h-vehicles">
          Cars
          <span className="td-count">{items.length}</span>
        </h2>
        <button type="button" className="td-section-link" onClick={() => openModule(MOD)}>
          <Icon name="car" size={13} /> Cars
        </button>
      </header>
      <ul className="rm-today-rows">
        {items.map((d) => (
          <li key={`${d.vehicle.path}:${d.what}`} className={`rm-today-row${d.late ? ' is-late' : ' is-change'}`}>
            <button type="button" className="rm-today-main" onClick={() => openVehicle(d.vehicle.path)}>
              <span className="rm-today-name">
                {d.vehicle.name}: {lower(d.words)}
              </span>
              <span className="rm-today-sub">{[d.vehicle.rego, d.what === 'insurance' && d.vehicle.insurer].filter(Boolean).join(' · ') || d.vehicle.kind}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
