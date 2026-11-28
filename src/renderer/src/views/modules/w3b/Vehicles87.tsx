// Cars' 8.7 pages (30 Oct 2026): the overview (vehicles.html: each vehicle, reminders, the home card) and a car's
// page (vehicles-car.html: fuel with its trend, the distance log, service history). Every ability the old pages had
// lives here: vehicles added, renewed and deleted to the Bin; fills logged with the odometer and taken out; trips
// logged for tax time; services recorded. The fuel and distance record views keep the previous layout. One primary
// button per screen.

import { distanceByYear, dueWords, type DueItem, type Vehicle } from '../../../../../shared/vehicles';
import { FUEL_TYPES, VEHICLE_KINDS, VEHICLE_STATUSES } from '../../../../../shared/personal-modules';
import { partOn } from '../../../../../shared/life-modules';
import { openMenu } from '../../../components/Menu';
import { writeLink } from '../../../lib/links';
import * as A from '../../../state/actions';
import { openTour } from '../../../state/moduleFills';
import { openModule, partOfTab, useModules } from '../../../state/modules';
import { toast } from '../../../state/store';
import { useWork, workDid } from '../../../state/workModules';
import type * as W from '../../../state/workspace';
import { dayText } from '../work/WorkShell';
import { logFill, logTrip, newVehicle, openVehicle, recordService, renewed, saveProp, vehicleMenu, vehiclesOptions, type VehiclesView } from '../personal/VehiclesPage';
import { caller, Inline, money, plural } from '../personal/PersonalParts';
import { PackReadState, AskFloat, FillsLine, HomeCard, MoreButton, PackHead, PackPage, PageProps, RowsCard, Section, trashRecord, useCanEdit, FULL_DETAILS_LABEL , EDIT_DETAILS_LABEL } from './W3b';
import { deleteToBin } from '../../../lib/removeWords';

const MOD = 'vehicles';
const call = caller(MOD);
const km = (n: number | null) => (n === null ? '' : n.toLocaleString('en-AU'));
const dueTint = (d: { late: boolean; soon: boolean }) => (d.late ? 'red' : d.soon ? 'amber' : 'slate') as 'slate' | 'green' | 'amber' | 'red' | 'blue';
const trendWords = (v: Vehicle) => (v.trend === 'better' ? 'trending down' : v.trend === 'worse' ? 'trending up' : v.trend === 'steady' ? 'steady' : '');
const DMON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "1 Feb" (with the year when it isn't this one, or when it is already past): for short due words. Overdue
 *  pills keep the year (packs uplift item 12), so a service 9 months back never reads "Service 1 Feb". */
const dmy = (iso: string, today: string) => `${Number(iso.slice(8, 10))} ${DMON[Number(iso.slice(5, 7)) - 1]}${iso < today || iso.slice(0, 4) !== today.slice(0, 4) ? ` ${iso.slice(0, 4)}` : ''}`;

function Reminders({ dues, m, canEdit }: { dues: DueItem[]; m: VehiclesView; canEdit: boolean }) {
  return (
    <>
      {dues.slice(0, 6).map((d) => (
        <div key={`${d.vehicle.path}:${d.what}`} className="trow">
          <button type="button" className="t clip" style={{ background: 'none', border: 0, cursor: 'pointer', font: 'inherit', textAlign: 'left', color: 'var(--text)', fontSize: 15 }} onClick={() => openVehicle(d.vehicle.path)}>{d.label}, {d.vehicle.name}</button>
          <span className="meta clip" style={{ marginLeft: 'auto' }}>{dueWords(d, m.today)}</span>
          <span className={`tag ${dueTint(d)}`}>{d.late ? 'Overdue' : d.soon ? 'Soon' : 'Later'}</span>
          {canEdit && d.what === 'service' && <button type="button" className="btn quiet" onClick={() => void recordService(m, d.vehicle)}>Log service</button>}
          {canEdit && d.what !== 'service' && <button type="button" className="btn quiet" onClick={() => renewed(d.vehicle, d.what as 'rego' | 'insurance', m.today)}>Renewed</button>}
        </div>
      ))}
    </>
  );
}

export function VehiclesOverview({ tab }: { tab: W.TabState }) {
  void tab;
  const canEdit = useCanEdit();
  const modules = useModules();
  const fuelOn = partOn(modules, MOD, 'fuel');
  const { data: m, error } = useWork<VehiclesView>(MOD);
  const first = m?.due[0];
  const trending = (m?.vehicles ?? []).filter((v) => v.trend === 'better').length;
  return (
    <PackPage label="Cars">
      <PackHead glyph="◉" tint="slate" title="Cars" lead="Rego, insurance, services, fuel and distance for tax time."
        actions={<>{canEdit && <button type="button" className="btn pri" onClick={() => newVehicle()}>+ Add a vehicle</button>}<MoreButton label="More for Cars" onOpen={(el) => openMenu(el, [
          { label: 'Fuel log', icon: 'fuel', disabled: !fuelOn, run: () => openModule(MOD, 'fuel') },
          { label: 'Distance for tax', icon: 'receipt', run: () => openModule(MOD, 'distance') },
          { label: 'Cars options…', icon: 'settings', disabled: !canEdit || !m, run: () => m && vehiclesOptions(m) },
          { label: 'Show me around Cars', icon: 'sparkle', run: () => openTour('vehicles') },
          { label: 'Show the folder', icon: 'folder', disabled: !m, run: () => m && A.revealInExplorer(m.folder) },
          { separator: true },
          { label: FULL_DETAILS_LABEL, icon: 'history', run: () => openModule(MOD, 'classic') },
        ])} /></>} />
      {m && <PageProps facts={[...(m.due.length ? [{ k: 'Due soon', v: <>{m.due.slice(0, 2).map((d, i) => <span key={`${d.vehicle.path}:${d.what}`}><span className={`pill ${d.late ? 'red' : d.soon ? 'amber' : 'green'}`}>{d.what[0].toUpperCase() + d.what.slice(1)} {d.date ? dmy(d.date, m.today) : d.kmLeft !== null ? `${km(d.kmLeft)} km` : 'due'}</span>{i === 0 && m.due.length > 1 ? ' ' : ''}</span>)}</> }] : []), ...(m.vehicles.length ? [{ k: 'Kept', v: `${plural(m.vehicles.length, 'vehicle')}${trending ? ' · fuel use trending down' : ''}` }] : [])]} />}
      {/* The fills line sits under the head when empty, as House's does (t254, 13 Nov 2026: with no facts
          and no fills line the first section paired and ended mid-column, off every other room's edge). */}
      {m && !m.vehicles.length && !m.due.length && <FillsLine id="vehicles" />}
      {error && <p className="vsub">{error}</p>}
      {!m && !error && <p className="vsub">Reading your vehicles…</p>}
      {m && (
        <Section label="Vehicles">
          {/* Bare when there is nothing but the line (t254: one short line in a box is the empty space). */}
          {!m.vehicles.length ? (
            <p className="vsub" style={{ padding: '9px 0' }}>No vehicles yet. Add each car, bike or trailer with its rego, insurance and service days.</p>
          ) : (
          <div className="card" style={{ padding: '6px 20px' }}>
            {m.vehicles.map((v) => {
              const svc = v.dues.find((d) => d.what === 'service');
              const allCurrent = v.dues.every((d) => !d.late && !d.soon);
              return (
                <div key={v.path} className="trow">
                  <span className="gtile xs slate">◉</span>
                  <button type="button" className="t clip" style={{ background: 'none', border: 0, cursor: 'pointer', font: 'inherit', textAlign: 'left', color: 'var(--text)', fontSize: 15 }} onClick={() => openVehicle(v.path)} title={`Open ${v.name}`}>{v.name}{[v.make, v.model, v.year].filter(Boolean).length ? `, ${[v.make, v.model, v.year].filter(Boolean).join(' ')}` : ''}</button>
                  <span className="meta" style={{ marginLeft: 'auto' }}>{v.odometer !== null ? `${km(v.odometer)} km` : ''}</span>
                  <span className={`tag ${svc && (svc.late || svc.soon) ? dueTint(svc) : allCurrent ? 'green' : 'slate'}`}>{svc?.date ? `Service ${dmy(svc.date, m.today)}` : allCurrent ? 'On the road' : 'No service day'}</span>
                </div>
              );
            })}
          </div>
          )}
        </Section>
      )}
      {m && (
        <Section label="Reminders">
          {/* Bare when there is nothing but the line (t254); the rows keep their card. */}
          {!m.due.length ? (
            <p className="vsub" style={{ padding: '9px 0' }}>Nothing due. Rego, insurance and service days show here before they arrive.</p>
          ) : (
          <div className="card" style={{ padding: '6px 20px' }}>
            <Reminders dues={m.due} m={m} canEdit={canEdit} />
          </div>
          )}
        </Section>
      )}
      {first && m && <HomeCard pack="Cars" glyph="◉" tint="amber" title={`${first.vehicle.name} ${first.label.toLowerCase()} ${first.date ? `due ${dayText(first.date)}` : 'due'}${first.kmLeft !== null && first.kmLeft > 0 ? ` or ${km(first.kmLeft)} km` : ''}`} meta={first.late ? `overdue${m.due.length > 1 ? ` · ${m.due.length - 1} more due` : ''}` : m.due.length > 1 ? `${m.due.length - 1} more due` : 'rego, insurance current'} />}
    </PackPage>
  );
}

// ── A car's page ─────────────────────────────────────────────────────────────────────────────────────────────────

export function VehicleDetail({ path }: { path: string }) {
  const canEdit = useCanEdit();
  const modules = useModules();
  const fuelOn = partOn(modules, MOD, 'fuel');
  const { data: m, error, reload } = useWork<VehiclesView>(MOD);
  const v = m?.vehicles.find((x) => x.path === path);
  if (!m) return <PackReadState label="Cars" error={error} reload={reload}>Reading your vehicles…</PackReadState>;
  if (!v) return <PackPage label="Cars"><div className="card" style={{ marginTop: 14 }}><p className="vsub">That vehicle isn’t here any more.</p><p style={{ marginTop: 8 }}><button type="button" className="btn" onClick={() => openModule(MOD)}>Cars</button></p></div></PackPage>;
  const prop = (field: string) => (x: string) => saveProp(v, field, x);
  const fills = [...v.fills].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || (b.odometer ?? 0) - (a.odometer ?? 0));
  const services = [...v.services].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
  const years = distanceByYear(v.trips);
  const rego = v.dues.find((d) => d.what === 'rego');
  const ins = v.dues.find((d) => d.what === 'insurance');
  const svc = v.dues.find((d) => d.what === 'service');
  const subHead = [[v.year, v.kind ? v.kind.toLowerCase() : ''].filter(Boolean).join(' '), v.fuel ? v.fuel.toLowerCase() : ''].filter(Boolean).join(', ');
  const subBits = [subHead, v.odometer !== null ? `${km(v.odometer)} km on the clock` : ''].filter(Boolean);
  const sub = subBits.length ? `${subBits.join('. ')}.` : '';
  const title = [v.make, v.model].filter(Boolean).join(' ');
  const copyLink = () => { void navigator.clipboard.writeText(writeLink(v.path, undefined)).then(() => toast('A link to the car is on the clipboard.')); };
  return (
    <PackPage label={v.name}>
      <PackHead glyph="◉" tint="slate" title={title ? `${v.name}, ${title}` : v.name} lead={sub} sharePath={v.path}
        actions={<>{canEdit && fuelOn && <button type="button" className="btn pri" onClick={() => logFill(m, v)}>Log a fill</button>}<MoreButton label={`More for ${v.name}`} onOpen={(el) => openMenu(el, [...vehicleMenu(v, m, canEdit), { label: 'Copy link', icon: 'link', run: copyLink }, { label: EDIT_DETAILS_LABEL, icon: 'table', run: () => openModule(MOD, `classic:vehicle:${encodeURIComponent(v.path)}`) }, { separator: true }, { label: deleteToBin('the car'), icon: 'trash', danger: true, disabled: !canEdit, run: () => void trashRecord(v.path).then((ok) => ok && openModule(MOD)) }])} /></>} />
      <PageProps facts={[
        { k: 'Rego', v: `${v.rego || 'No plate yet'}${v.regoDue ? ` · due ${dayText(v.regoDue)}` : ''}` },
        { k: 'Insurance', v: `${v.insurer || 'No insurer yet'}${v.insuranceDue ? ` · until ${dayText(v.insuranceDue)}` : ''}` },
        ...(svc ? [{ k: 'Service', v: <span className={`pill ${svc.late ? 'red' : svc.soon ? 'amber' : 'green'}`}>{svc.date && svc.kmLeft !== null && svc.kmLeft > 0 ? `Due ${dmy(svc.date, m.today)} or ${km(svc.kmLeft)} km` : dueWords(svc, m.today)}</span> }] : []),
      ]} />
      {fuelOn && (
        <Section label={`Fuel${v.per100 !== null ? ` · ${v.per100} ${v.unit}/100 km` : ''}${trendWords(v) ? `, ${trendWords(v)}` : ''}`} action={canEdit ? <button type="button" className="btn quiet" onClick={() => logFill(m, v)}>Log a fill</button> : undefined}>
          {/* Bare when there is nothing but the line (t258, the shared RowsCard); the rows keep their card. */}
          <RowsCard empty={!fills.length} words="No fill-ups yet. Log each one with the odometer to see fuel use between full tanks.">
            {fills.slice(0, 5).map((f) => (
              <div key={f.row} className="trow">
                <span className="t clip">{f.full ? 'Full tank' : 'Part fill'}{f.station ? `, ${f.station}` : ''}</span>
                <span className="meta" style={{ marginLeft: 'auto' }}>{[f.litres !== null ? `${f.litres} ${v.unit}` : '', f.cost !== null ? money(f.cost, m.currency) : '', f.date ? dayText(f.date) : f.dateWords].filter(Boolean).join(' · ')}</span>
                {canEdit && <button type="button" className="btn quiet" aria-label={`Take the ${f.date ? dayText(f.date) : 'undated'} fill out`} onClick={() => void workDid(call<string>('remove-row', v.path, 'fuel', f.row, f.date ?? f.station))}>Take out</button>}
              </div>
            ))}
          </RowsCard>
        </Section>
      )}
      <Section label={`Distance log · ${years[0]?.year.replace('-', '–') ?? 'This year'}`} action={canEdit ? <button type="button" className="btn quiet" onClick={() => logTrip(m, v)}>Log a trip</button> : undefined}>
        {/* Bare when there is nothing but the line (t258, the shared RowsCard); the rows keep their card. */}
        <RowsCard empty={!v.trips.length} words="No trips logged. Log work trips with their kilometres for tax time.">
          {[...v.trips].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '')).slice(0, 5).map((t) => (
            <div key={t.row} className="trow">
              <span className="t clip">{t.reason || 'Trip'}</span>
              <span className="meta" style={{ marginLeft: 'auto' }}>{[t.km !== null ? `${km(t.km)} km` : '', t.date ? dayText(t.date) : t.dateWords].filter(Boolean).join(' · ')}</span>
              {canEdit && <button type="button" className="btn quiet" aria-label={`Take ${t.reason || 'the trip'} out`} onClick={() => void workDid(call<string>('remove-row', v.path, 'trips', t.row, t.reason))}>Take out</button>}
            </div>
          ))}
          {!!years.length && <div className="trow"><span className="t" style={{ fontWeight: 700 }}>Financial year so far</span><span className="meta" style={{ marginLeft: 'auto' }}>{km(years[0].km)} km</span></div>}
        </RowsCard>
      </Section>
      <Section label="Service history" action={canEdit ? <button type="button" className="btn quiet" onClick={() => void recordService(m, v)}>Record a service</button> : undefined}>
        {/* Bare when there is nothing but the line (t258, the shared RowsCard); with the next-service row
            the card keeps its box, as cards with rows do. */}
        <RowsCard empty={!services.length && !canEdit} words="No services recorded yet. Record one to set when the next is due.">
          {!services.length && canEdit && <p className="vsub w3b-bare">No services recorded yet. Record one to set when the next is due.</p>}
          {services.slice(0, 5).map((s) => (
            <div key={s.row} className="trow">
              <span className="t clip">{s.what}</span>
              <span className="meta" style={{ marginLeft: 'auto' }}>{[s.date ? dayText(s.date) : s.dateWords, s.where, s.cost !== null ? money(s.cost, m.currency) : ''].filter(Boolean).join(' · ')}</span>
              {canEdit && <button type="button" className="btn quiet" aria-label={`Take ${s.what} out`} onClick={() => void workDid(call<string>('remove-row', v.path, 'service', s.row, s.what))}>Take out</button>}
            </div>
          ))}
          {canEdit && (
            <div className="trow">
              <span className="t">Next service day</span>
              <span style={{ marginLeft: 'auto' }}><Inline value={v.serviceDue ?? ''} shown={v.serviceDue ? dayText(v.serviceDue) : undefined} label="Service due" kind="date" canEdit={canEdit} onSave={prop('service_due')} /></span>
              <span className="t">or km</span>
              <span><Inline value={v.serviceKm !== null ? String(v.serviceKm) : ''} label="Service km" kind="number" canEdit={canEdit} onSave={prop('service_km')} /></span>
            </div>
          )}
        </RowsCard>
      </Section>
      <Section label="Rego and insurance">
        <div className="card" style={{ padding: '6px 20px' }}>
          <div className="trow"><span className="t">Plate</span><span style={{ marginLeft: 'auto' }}><Inline value={v.rego} label="Plate" canEdit={canEdit} onSave={prop('rego')} /></span></div>
          <div className="trow"><span className="t">Rego due</span><span style={{ marginLeft: 'auto' }}><Inline value={v.regoDue ?? ''} shown={v.regoDue ? dayText(v.regoDue) : undefined} label="Rego due" kind="date" canEdit={canEdit} onSave={prop('rego_due')} /></span>{rego && <span className={`tag ${dueTint(rego)}`}>{rego.late ? 'Overdue' : rego.soon ? 'Soon' : 'Later'}</span>}{canEdit && <button type="button" className="btn quiet" onClick={() => renewed(v, 'rego', m.today)}>Renewed</button>}</div>
          <div className="trow"><span className="t">Insurer</span><span style={{ marginLeft: 'auto' }}><Inline value={v.insurer} label="Insurer" canEdit={canEdit} onSave={prop('insurer')} /></span></div>
          <div className="trow"><span className="t">Insurance until</span><span style={{ marginLeft: 'auto' }}><Inline value={v.insuranceDue ?? ''} shown={v.insuranceDue ? dayText(v.insuranceDue) : undefined} label="Insurance until" kind="date" canEdit={canEdit} onSave={prop('insurance_due')} /></span>{ins && <span className={`tag ${dueTint(ins)}`}>{ins.late ? 'Overdue' : ins.soon ? 'Soon' : 'Later'}</span>}{canEdit && <button type="button" className="btn quiet" onClick={() => renewed(v, 'insurance', m.today)}>Renewed</button>}</div>
        </div>
      </Section>
      <Section label="Details">
        <div className="card" style={{ padding: '6px 20px' }}>
          <div className="trow"><span className="t">Kind</span><span style={{ marginLeft: 'auto' }}><Inline value={v.kind} label="Kind" kind="choice" options={[...VEHICLE_KINDS]} canEdit={canEdit} onSave={prop('vehicle_kind')} /></span></div>
          <div className="trow"><span className="t">Make</span><span style={{ marginLeft: 'auto' }}><Inline value={v.make} label="Make" canEdit={canEdit} onSave={prop('make')} /></span></div>
          <div className="trow"><span className="t">Model</span><span style={{ marginLeft: 'auto' }}><Inline value={v.model} label="Model" canEdit={canEdit} onSave={prop('model')} /></span></div>
          <div className="trow"><span className="t">Year</span><span style={{ marginLeft: 'auto' }}><Inline value={v.year !== null ? String(v.year) : ''} label="Year" kind="number" canEdit={canEdit} onSave={prop('year')} /></span></div>
          <div className="trow"><span className="t">Fuel</span><span style={{ marginLeft: 'auto' }}><Inline value={v.fuel} label="Fuel" kind="choice" options={[...FUEL_TYPES]} canEdit={canEdit} onSave={prop('fuel_type')} /></span></div>
          <div className="trow"><span className="t">VIN</span><span style={{ marginLeft: 'auto' }}><Inline value={v.vin} label="VIN" canEdit={canEdit} onSave={prop('vin')} /></span></div>
          <div className="trow"><span className="t">Status</span><span style={{ marginLeft: 'auto' }}><Inline value={v.status} label="Status" kind="choice" options={[...VEHICLE_STATUSES]} canEdit={canEdit} onSave={prop('status')} /></span></div>
        </div>
      </Section>
      <AskFloat scope={v.path} />
    </PackPage>
  );
}

/** Cars' page switch: the new overview, a car's new page, the rest as before. */
export function vehiclesPlace(tab: W.TabState): 'overview' | 'vehicle' | 'classic' | 'rest' {
  const part = partOfTab(tab) ?? 'overview';
  if (part === 'classic' || part.startsWith('classic:')) return 'classic';
  if (part.startsWith('vehicle:')) return 'vehicle';
  if (part === 'overview' || part === '') return 'overview';
  return 'rest';
}
export const vehiclePathOf = (tab: W.TabState): string | null => {
  const part = partOfTab(tab) ?? '';
  if (!part.startsWith('vehicle:')) return null;
  try { return decodeURIComponent(part.slice(8)); } catch { return part.slice(8); }
};
