// Trips' 8.7 pages (30 Oct 2026): the overview (travel.html: the next trip day by day, every trip, the home card) and
// a trip's page (travel-trip.html: the checklist, spend against the budget, days, papers). Every ability the old
// pages had lives here: trips planned, changed and deleted to the Bin; bookings added, marked paid and taken out;
// expenses added and taken out; papers kept; passports checked. The timeline and record views keep the previous
// layout. One primary button per screen.

import { BOOKING_KINDS, TRIP_PURPOSES, TRIP_STATUSES } from '../../../../../shared/personal-modules';
import { bookingWords, tripRangeShort, tripRangeWords, untilWords, type Booking, type Trip } from '../../../../../shared/travel';
import { openMenu } from '../../../components/Menu';
import { writeLink } from '../../../lib/links';
import * as A from '../../../state/actions';
import { openTour } from '../../../state/moduleFills';
import { openModule, partOfTab } from '../../../state/modules';
import { toast } from '../../../state/store';
import { useWork, workDid } from '../../../state/workModules';
import type * as W from '../../../state/workspace';
import { dayText } from '../work/WorkShell';
import { newBooking, newExpense, newTrip, openTrip, save, travelOptions, tripMenu, type TravelView } from '../personal/TravelPage';
import { caller, fileName, Inline, money, plural } from '../personal/PersonalParts';
import { AskFloat, FillsLine, HomeCard, Meter, MoreButton, PackHead, PackPage, PageProps, RowsCard, Section, Tick, trashRecord, useCanEdit, FULL_DETAILS_LABEL , EDIT_DETAILS_LABEL } from './W3b';
import { TAKE_OFF_BUTTON, deleteToBin, takeOffAria } from '../../../lib/removeWords';

const MOD = 'travel';
const call = caller(MOD);
/** Booked when paid or holding a reference (9.2 uplift F118): a day passing never books it. */
const booked = (b: Booking) => b.paid || !!b.booking;
/** Holding a reference but not paid: reads To pay, never Booked (packs uplift item 7). */
const toPay = (b: Booking) => !b.paid && !!b.booking;
/** Past its day but never booked: reads Past, never Done. */
const pastDue = (b: Booking, today: string) => !booked(b) && b.date !== null && b.date < today;
/** A trip's tag: over budget, done, cancelled, away, on budget, or its status when it has no budget. */
const tripTag = (x: Trip): [string, 'slate' | 'green' | 'amber' | 'red' | 'blue'] => x.left !== null && x.left < 0 ? ['Over budget', 'red'] : x.phase === 'Back' ? ['Done', 'slate'] : x.phase === 'Cancelled' ? ['Cancelled', 'red'] : x.phase === 'Away' ? ['Away', 'blue'] : x.budget !== null ? ['On budget', 'green'] : [x.status, 'slate'];

function ChecklistRow({ x, b, m, canEdit }: { x: Trip; b: Booking; m: TravelView; canEdit: boolean }) {
  const done = b.paid;
  const past = pastDue(b, m.today);
  const pay = toPay(b);
  return (
    <div className="trow">
      <Tick done={done} title={`${b.what || b.kind}${b.booking ? `, ref ${b.booking}` : ''}`} meta={[b.kind !== 'Other' ? b.kind : '', b.where, b.cost !== null ? money(b.cost, m.currency) : ''].filter(Boolean).join(' · ')} tag={done ? 'Done' : past ? 'Past' : pay ? 'To pay' : 'To book'} tagTone={done ? 'green' : past || pay ? 'amber' : 'slate'} label={`${b.what || b.kind}: ${done ? 'paid' : past ? 'past, never booked' : pay ? 'to pay' : 'to book'}`} onTick={() => canEdit && void save('booking', x.path, 'is_paid', done ? 'No' : 'Yes', { row: b.row, title: b.what || b.kind })} />
      {canEdit && <button type="button" className="btn quiet" aria-label={takeOffAria(b.what || b.kind)} onClick={() => void workDid(call<string>('remove-row', x.path, 'itinerary', b.row, b.what || b.kind))}>{TAKE_OFF_BUTTON}</button>}
    </div>
  );
}

export function TravelOverview({ tab }: { tab: W.TabState }) {
  void tab;
  const canEdit = useCanEdit();
  const { data: m, error } = useWork<TravelView>(MOD);
  const next = m?.away[0] ?? m?.upcoming[0] ?? null;
  return (
    <PackPage label="Trips">
      <PackHead glyph="✈" tint="green" title="Trips" lead="Flights, stays, day plans, papers and spend against each budget."
        actions={<>{canEdit && <button type="button" className="btn pri" onClick={() => newTrip(m)}>+ Plan a trip</button>}<MoreButton label="More for Trips" onOpen={(el) => openMenu(el, [
          { label: 'Timeline', icon: 'chart', run: () => openModule(MOD, 'timeline') },
          { label: 'Every booking', icon: 'receipt', run: () => openModule(MOD, 'itinerary') },
          { label: 'Every expense', icon: 'receipt', run: () => openModule(MOD, 'expenses') },
          { label: 'Forecast', icon: 'chart', run: () => openModule(MOD, 'forecast') },
          { label: 'Trips options…', icon: 'settings', disabled: !canEdit || !m, run: () => m && travelOptions(m) },
          { label: 'Show me around Trips', icon: 'sparkle', run: () => openTour('travel') },
          { separator: true },
          { label: FULL_DETAILS_LABEL, icon: 'history', run: () => openModule(MOD, 'classic') },
        ])} /></>} />
      {m && <PageProps facts={[
        ...(next ? [{ k: 'Next trip', v: `${next.name} · ${tripRangeShort(next) || next.phase}${next.daysTo !== null && next.daysTo > 0 ? ` · ${plural(next.daysTo, 'day')} to go` : ''}` }] : []),
        // No trips, no forecast (p15 packs-life, 4 Nov 2026, "empty states that say nothing go"): "$0 spent this
        // year" goes away with the trips it would count.
        ...(m.trips.length ? [{ k: 'Forecast', v: `${money(m.thisYear, m.currency, false)} spent this year` }] : []),
      ]} />}
      {/* The fills line sits under the head when empty, as House's does (t254). */}
      {m && !m.trips.length && <FillsLine id="travel" />}
      {error && <p className="vsub">{error}</p>}
      {!m && !error && <p className="vsub">Reading your trips…</p>}
      {m && next && (
        <Section label={`Next trip · ${next.phase === 'Away' ? 'Away now' : 'Day by day'}`} action={<button type="button" className="btn quiet" onClick={() => openTrip(next.path)}>Open {next.name}</button>}>
          {/* Bare when there is nothing but the line (t254); the rows keep their card. */}
          {!next.days.length ? (
            <p className="vsub" style={{ padding: '9px 0' }}>No flights, hotels or plans yet.</p>
          ) : (
          <div className="card" style={{ padding: '6px 20px' }}>
            {next.days.slice(0, 4).map((d) => (
              <div key={d.date ?? 'none'} className="trow">
                <span className="t clip" style={{ fontWeight: 600, flex: 'none' }}>{d.date ? dayText(d.date) : 'No day yet'}</span>
                <span className="meta clip">{d.items.slice(0, 3).map((b) => bookingWords(b, m.today)).join(' · ')}</span>
                <span className={`tag ${d.items.every((b) => b.paid) ? 'green' : d.items.every(booked) || d.items.some((b) => pastDue(b, m.today)) ? 'amber' : 'slate'}`} style={{ marginLeft: 'auto' }}>{d.items.every((b) => b.paid) ? 'Booked' : d.items.every(booked) ? 'To pay' : d.items.some((b) => pastDue(b, m.today)) ? 'Past' : 'Planned'}</span>
              </div>
            ))}
          </div>
          )}
        </Section>
      )}
      {m && (
        <Section label="All trips">
          {/* Bare when there is nothing but the line (t254); the rows keep their card. The fills line sits
              under the head when empty, as House's does. */}
          {!m.trips.length ? (
            <p className="vsub" style={{ padding: '9px 0' }}>No trips yet. Plan one with its flights, stays and budget.</p>
          ) : (
          <div className="card" style={{ padding: '6px 20px' }}>
            {m.trips.map((x) => (
              <div key={x.path} className="trow">
                <button type="button" className="t clip" style={{ background: 'none', border: 0, cursor: 'pointer', font: 'inherit', textAlign: 'left', color: 'var(--text)', fontSize: 15 }} onClick={() => openTrip(x.path)} title={`Open ${x.name}`}>{x.name}</button>
                <span className="meta clip" style={{ marginLeft: 'auto' }}>{[tripRangeShort(x) || x.phase, x.budget !== null ? `${money(x.forecast, m.currency, false)} of ${money(x.budget, m.currency, false)}` : x.phase === 'Back' ? `${money(x.forecast, m.currency, false)} spent` : x.status].filter(Boolean).join(' · ')}</span>
                {(() => { const [words, tone] = tripTag(x); return <span className={`tag ${tone}`}>{words}</span>; })()}
              </div>
            ))}
          </div>
          )}
        </Section>
      )}
      {m && next && (() => {
        const unpaid = next.bookings.filter((b) => !b.paid);
        const pay = unpaid.filter((b) => b.booking);
        const book = unpaid.filter((b) => !b.booking);
        const left = !next.bookings.length ? '' : !unpaid.length ? ' · everything paid' : pay.length && book.length ? ` · ${pay.length} to pay, ${book.length} to book` : pay.length ? ` · ${plural(pay.length, 'booking')} to pay` : ` · ${plural(book.length, 'booking')} to book`;
        const meta = !next.bookings.length ? 'No bookings yet' : unpaid.length ? unpaid.slice(0, 2).map((b) => (b.what || b.kind).toLowerCase()).join(' + ') : '';
        return <HomeCard pack="Trips" glyph="✈" tint="green" title={`${next.destination || next.name}${next.daysTo !== null && next.daysTo > 0 ? ` in ${plural(next.daysTo, 'day')}` : ''}${left}`} meta={meta} />;
      })()}
    </PackPage>
  );
}

// ── A trip's page ────────────────────────────────────────────────────────────────────────────────────────────────

export function TripDetail({ path }: { path: string }) {
  const canEdit = useCanEdit();
  const { data: m } = useWork<TravelView>(MOD);
  const x = m?.trips.find((t) => t.path === path);
  if (!m) return <PackPage label="Trips"><p className="vsub">Reading your trips…</p></PackPage>;
  if (!x) return <PackPage label="Trips"><div className="card" style={{ marginTop: 14 }}><p className="vsub">That trip isn’t here any more.</p><p style={{ marginTop: 8 }}><button type="button" className="btn" onClick={() => openModule(MOD)}>Trips</button></p></div></PackPage>;
  const prop = (field: string) => (v: string) => save('trip', x.path, field, v);
  const done = x.bookings.filter((b) => b.paid).length;
  const cats = new Map<string, number>();
  for (const b of x.bookings) if (b.cost !== null) cats.set(b.kind, (cats.get(b.kind) ?? 0) + b.cost);
  for (const e of x.expenses) if (e.amount !== null) cats.set(e.category, (cats.get(e.category) ?? 0) + e.amount);
  const byCat = [...cats.entries()].sort((a, b) => b[1] - a[1]);
  const total = byCat.reduce((n, [, v]) => n + v, 0);
  const dates = tripRangeWords(x);
  const copyLink = () => { void navigator.clipboard.writeText(writeLink(x.path, undefined)).then(() => toast('A link to the trip is on the clipboard.')); };
  return (
    <PackPage label={x.name}>
      <PackHead glyph="✈" tint="green" title={dates ? `${x.name} – ${dates}` : x.name} sharePath={x.path} lead={[x.destination, x.notes.split('\n')[0]].filter(Boolean).join('. ') || 'Its flights, hotels and plans, its documents and what it costs.'}
        actions={<>{canEdit && <button type="button" className="btn pri" onClick={(e) => openMenu(e.currentTarget, BOOKING_KINDS.slice(0, 8).map((k) => ({ label: k, run: () => newBooking(x, k) })))}>Add a booking</button>}<MoreButton label={`More for ${x.name}`} onOpen={(el) => openMenu(el, [...tripMenu(x, m, canEdit), { label: 'Copy link', icon: 'link', run: copyLink }, { label: 'Add an expense…', icon: 'receipt', disabled: !canEdit, run: () => newExpense(x, m.today) }, { label: EDIT_DETAILS_LABEL, icon: 'table', run: () => openModule(MOD, `classic:trip:${encodeURIComponent(x.path)}`) }, { separator: true }, { label: deleteToBin('the trip'), icon: 'trash', danger: true, disabled: !canEdit, run: () => void trashRecord(x.path).then((ok) => ok && openModule(MOD)) }])} /></>} />
      <PageProps facts={[
        { k: 'Budget', v: x.budget !== null ? `${money(x.forecast, m.currency, false)} of ${money(x.budget, m.currency, false)}${x.left !== null && x.left < 0 ? ', over budget' : ''}` : `${money(x.forecast, m.currency, false)} forecast, no budget set` },
        { k: 'Bookings', v: <><span className="pill green">{done} done</span> <span className="pill amber">{x.bookings.length - done} to go</span></> },
      ]} />
      <Section label="Checklist" action={canEdit ? <button type="button" className="btn quiet" onClick={() => newBooking(x)}>Add a booking</button> : undefined}>
        {/* Bare when there is nothing but the line (t258, the shared RowsCard); the rows keep their card. */}
        <RowsCard empty={!x.bookings.length} words="No flights, hotels or plans yet.">
          {x.bookings.map((b) => <ChecklistRow key={b.row} x={x} b={b} m={m} canEdit={canEdit} />)}
        </RowsCard>
      </Section>
      {!!byCat.length && (
        <Section label="Spend against budget">
          <div className="card">
            {x.budget !== null && <Meter name="Total" spent={x.forecast} budget={x.budget} words={`${money(x.forecast, m.currency, false)} of ${money(x.budget, m.currency, false)}`} />}
            {byCat.slice(0, 6).map(([cat, amount]) => <Meter key={cat} name={cat} spent={amount} budget={total} words={money(amount, m.currency, false)} />)}
          </div>
        </Section>
      )}
      {!!x.days.length && (
        <Section label="Day by day">
          <div className="card" style={{ padding: '6px 20px' }}>
            {x.days.map((d) => (
              <div key={d.date ?? 'none'} className="trow">
                <span className="t clip" style={{ fontWeight: 600, flex: 'none' }}>{d.date ? dayText(d.date) : 'No day yet'}</span>
                <span className="meta clip">{d.items.map((b) => `${b.time ? `${b.time} ` : ''}${bookingWords(b, m.today)}${b.until ? ` until ${untilWords(b.until, m.today)}` : ''}`).join(' · ')}</span>
              </div>
            ))}
          </div>
        </Section>
      )}
      {!!x.expenses.length && (
        <Section label="Expenses" action={canEdit ? <button type="button" className="btn quiet" onClick={() => newExpense(x, m.today)}>Add an expense</button> : undefined}>
          <div className="card" style={{ padding: '6px 20px' }}>
            {x.expenses.map((e) => (
              <div key={e.row} className="trow">
                <span className="t clip">{e.what}</span>
                <span className="meta" style={{ marginLeft: 'auto' }}>{[e.category, e.amount !== null ? money(e.amount, m.currency) : '', e.paidBy ? `paid by ${e.paidBy}` : '', e.date ? dayText(e.date) : ''].filter(Boolean).join(' · ')}</span>
                {canEdit && <button type="button" className="btn quiet" aria-label={`Take ${e.what} out`} onClick={() => void workDid(call<string>('remove-row', x.path, 'expenses', e.row, e.what))}>Take out</button>}
              </div>
            ))}
          </div>
        </Section>
      )}
      <Section label="Papers">
        {/* Bare when there is nothing but the line (t258, the shared RowsCard); the rows keep their card. */}
        <RowsCard empty={!x.files.length} words="Tickets, confirmations and copies of passports, kept with the trip.">
          {x.files.map((f) => (
            <div key={f} className="trow">
              <span className="gtile xs slate">▤</span>
              <button type="button" className="t clip" style={{ background: 'none', border: 0, cursor: 'pointer', font: 'inherit', textAlign: 'left', color: 'var(--text)', fontSize: 15 }} onClick={() => A.openPath(f)}>{fileName(f)}</button>
            </div>
          ))}
        </RowsCard>
        {!!x.passports.length && (
          <div className={`callout ${x.passports.every((p) => p.ok) ? 'green' : 'amber'}`} style={{ marginTop: 12 }}>
            <span>{x.passports.every((p) => p.ok) ? 'Every traveller’s passport is in date for this trip.' : x.passports.filter((p) => !p.ok).map((p) => p.words).join(' ')}</span>
          </div>
        )}
      </Section>
      <Section label="Details">
        <div className="card" style={{ padding: '6px 20px' }}>
          <div className="trow"><span className="t">Destination</span><span style={{ marginLeft: 'auto' }}><Inline value={x.destination} label="Destination" canEdit={canEdit} onSave={prop('destination')} /></span></div>
          <div className="trow"><span className="t">Leaving</span><span style={{ marginLeft: 'auto' }}><Inline value={x.starts ?? ''} shown={x.starts ? dayText(x.starts) : undefined} label="Leaving" kind="date" canEdit={canEdit} onSave={prop('starts')} /></span></div>
          <div className="trow"><span className="t">Back</span><span style={{ marginLeft: 'auto' }}><Inline value={x.ends ?? ''} shown={x.ends ? dayText(x.ends) : undefined} label="Back" kind="date" canEdit={canEdit} onSave={prop('ends')} /></span></div>
          <div className="trow"><span className="t">Purpose</span><span style={{ marginLeft: 'auto' }}><Inline value={x.purpose} label="Purpose" kind="choice" options={[...TRIP_PURPOSES]} canEdit={canEdit} onSave={prop('purpose')} /></span></div>
          <div className="trow"><span className="t">Status</span><span style={{ marginLeft: 'auto' }}><Inline value={x.status} label="Status" kind="choice" options={[...TRIP_STATUSES]} canEdit={canEdit} onSave={prop('status')} /></span></div>
          <div className="trow"><span className="t">Budget</span><span style={{ marginLeft: 'auto' }}><Inline value={x.budget !== null ? String(x.budget) : ''} shown={x.budget !== null ? money(x.budget, m.currency, false) : undefined} label="Budget" kind="number" canEdit={canEdit} onSave={prop('budget')} /></span></div>
          <div className="trow"><span className="t">Travellers</span><span style={{ marginLeft: 'auto' }}><Inline value={x.travellers.join(', ')} label="Travellers" canEdit={canEdit} onSave={prop('travellers')} /></span></div>
        </div>
      </Section>
      <AskFloat scope={x.path} />
    </PackPage>
  );
}

/** Trips' page switch: the new overview, a trip's new page, the rest as before. */
export function travelPlace(tab: W.TabState): 'overview' | 'trip' | 'classic' | 'rest' {
  const part = partOfTab(tab) ?? 'overview';
  if (part === 'classic' || part.startsWith('classic:')) return 'classic';
  if (part.startsWith('trip:')) return 'trip';
  if (part === 'overview' || part === '') return 'overview';
  return 'rest';
}
export const tripPathOf = (tab: W.TabState): string | null => {
  const part = partOfTab(tab) ?? '';
  if (!part.startsWith('trip:')) return null;
  try { return decodeURIComponent(part.slice(5)); } catch { return part.slice(5); }
};
