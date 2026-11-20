// Travel on the main side (Wave 7 part a; src/shared/travel.ts). Its notes read from the index with the passports kept in
// Documents and ID (checked against each trip still to come), each change one property or one cell of a trip's
// itinerary or expenses (every other character kept), a booking or an expense added as a row, boarding passes and
// bookings kept beside a trip, the bell told of a trip coming up and the day's flights and check-ins (each said once),
// the Inbox's bookings filed with their trip, and its tools through each agent's gate.

import { partOn } from '../../shared/life-modules';
import { readAmount, readDay, tableWithRow } from '../../shared/personal-records';
import { answerTravelTool, bookingWords, EXPENSES_TABLE, ITINERARY_TABLE, leavingChecklist, newTripText, planBooking, planCalendarImport, planExpense, planTripAdd, TRAVEL_CELL, TRAVEL_TABLES, TRIP_PROPS, tripName, travelModel, tripDates, type PassportInfo, type TravelModel, type TripInput } from '../../shared/travel';
import type { VaultIndex } from '../indexer';
import type { WorkModules, WorkNotice } from '../work-modules';
import { inboxLine, itemWords, namedIn, personalRecords, S, remindDaysOption, type PersonalPart } from './common';

export type TravelView = TravelModel & { folder: string; currency: string; people: string[]; projects: { path: string; name: string }[] };

const TYPES = ['trip'];
const isPassport = (_p: string, props: Record<string, unknown>) => String(props.type ?? '').toLowerCase() === 'id-document' && /^passport$/i.test(String(props.kind ?? '').trim());

export function makeTravel(w: WorkModules): PersonalPart {
  const r = personalRecords(w, {
    module: 'travel',
    types: TYPES,
    tables: TRAVEL_TABLES,
    props: { trip: TRIP_PROPS },
    cells: { booking: { table: ITINERARY_TABLE, map: TRAVEL_CELL.booking }, expense: { table: EXPENSES_TABLE, map: TRAVEL_CELL.expense } },
  });
  const model = async (index: VaultIndex = w.d.index): Promise<TravelModel> => {
    const all = await r.notes(index, true, isPassport);
    const passports: PassportInfo[] = all.filter((n) => n.type === 'id-document' || String(n.props.type) === 'id-document').map((n) => ({ name: n.title, path: n.path, holder: S(n.props.holder, 80), expires: readDay(n.props.expires) }));
    return travelModel(all.filter((n) => n.type === 'trip'), w.today(), await w.remindDays('travel'), passports);
  };
  const view = async (): Promise<TravelView> => ({ ...(await model()), folder: await w.moduleFolder('travel'), currency: await r.currency(), people: (await r.people()).map((p) => p.name), projects: w.d.projects() });
  const trip = async (rel: unknown) => {
    const m = await model();
    const x = m.trips.find((t) => t.path === S(rel, 1000));
    if (!x) throw new Error('That trip isn’t there any more.');
    return { m, x };
  };

  const addTrip = async (input: unknown): Promise<string> => {
    const i = (input ?? {}) as TripInput & { name?: string };
    const destination = S(i.destination, 100);
    if (!destination && !S(i.name, 100)) throw new Error('A trip needs its destination.');
    for (const k of ['starts', 'ends'] as const) if (S(i[k]) && !readDay(i[k])) throw new Error('Give days like 2026-11-20.');
    const starts = readDay(i.starts);
    const ends = readDay(i.ends);
    if (starts && ends && ends < starts) throw new Error('The trip ends before it starts: check the days.');
    const name = S(i.name, 100) || tripName(destination, starts);
    const m = await model();
    if (m.trips.some((t) => t.name.toLowerCase() === name.toLowerCase())) throw new Error(`There’s already a trip called ${name}.`);
    return w.newNote(await w.folderOf('trip'), name, newTripText({ destination, starts, ends, purpose: S(i.purpose, 20), status: S(i.status, 20), budget: readAmount(i.budget), travellers: Array.isArray(i.travellers) ? i.travellers.map((x) => S(x, 80)).filter(Boolean) : [], project: S(i.project, 120) }));
  };

  const addBooking = async (rel: unknown, input: unknown): Promise<string> => {
    const { m, x } = await trip(rel);
    const plan = planBooking({ ...(input as Record<string, unknown>), trip: x.name }, { ...m, trips: [x] }, await r.currency());
    await w.change(x.path, (text) => tableWithRow(text, ITINERARY_TABLE, plan.values));
    return plan.words;
  };
  const addExpense = async (rel: unknown, input: unknown): Promise<string> => {
    const { m, x } = await trip(rel);
    const plan = planExpense({ ...(input as Record<string, unknown>), trip: x.name }, { ...m, trips: [x] }, await r.currency());
    await w.change(x.path, (text) => tableWithRow(text, EXPENSES_TABLE, plan.values));
    return plan.words;
  };

  const ops: PersonalPart['ops'] = {
    ...r.fileOps,
    model: () => view(),
    'add-trip': (input) => addTrip(input),
    'add-booking': (rel, input) => addBooking(rel, input),
    'add-expense': (rel, input) => addExpense(rel, input),
    options: async (patch) => {
      const p = (patch && typeof patch === 'object' ? patch : {}) as Record<string, unknown>;
      const remindDays = await remindDaysOption(w, 'travel', patch);
      if (typeof p.currency === 'string') await w.setOptions('travel', { settings: { currency: /^[A-Z]{3}$/.test(p.currency) ? p.currency : '' } });
      return { remindDays, currency: await r.currency() };
    },
  };

  return {
    id: 'travel',
    ops,
    async check(): Promise<WorkNotice[]> {
      if (!partOn(w.d.prefs().modules, 'travel', 'reminders')) return [];
      const m = await model();
      const out: WorkNotice[] = [];
      for (const x of m.upcoming.filter((t) => t.daysTo !== null && t.daysTo >= 0 && t.daysTo <= Math.min(m.remindDays, 2)))
        out.push({ key: `trip-soon:${x.path}:${x.starts}`, kind: 'travel', title: `${x.name}: leaving ${x.daysTo === 0 ? 'today' : x.daysTo === 1 ? 'tomorrow' : `in ${x.daysTo} days`}`, body: [tripDates(x, m.today), x.bookings.length ? `${x.bookings.length} bookings` : 'No bookings yet', ...x.passports.filter((p) => !p.ok).map((p) => p.words)].filter(Boolean).join(' · '), path: x.path });
      // A week out, the leaving checklist (30 Oct 2026, the uplift): passports, unpaid and codeless bookings, in the bell.
      for (const x of m.upcoming.filter((t) => t.daysTo !== null && t.daysTo > 2 && t.daysTo <= m.remindDays)) out.push({ key: `trip-checklist:${x.path}:${x.starts}`, kind: 'travel', title: `Leaving checklist: ${x.name}`, body: leavingChecklist(x, m.today).slice(0, 3).join(' · '), path: x.path });
      for (const b of m.bookings.filter((b) => b.days === 0 && /^(Flight|Hotel|Car hire|Train|Ferry|Transfer)$/.test(b.kind)))
        out.push({ key: `trip-booking:${b.trip}:${b.row}:${b.date}`, kind: 'travel', title: `${bookingWords(b, m.today)} today`, body: [b.tripName, b.where, b.booking && `booking ${b.booking}`].filter(Boolean).join(' · '), path: b.trip });
      return out;
    },
    async tool(name, args, ctx) {
      const mine = await model(ctx.gated);
      const refused = await r.refused(ctx, mine.trips.length);
      const cur = await r.currency();
      const read = answerTravelTool({ model: mine, on: w.isOn('travel'), refused, agent: ctx.agent, currency: cur }, name, args);
      if (read !== null) return read;
      if (name === 'travel_trip_add') {
        const plan = planTripAdd(args, mine);
        const rel = await w.freeNote(await w.folderOf('trip'), plan.name);
        ctx.check?.(rel);
        await w.d.requireCreate();
        await w.d.writeNote(rel, plan.text);
        return `${plan.words} [${rel}]`;
      }
      if (name === 'travel_import_calendar') {
        const plan = planCalendarImport(args, mine);
        ctx.check?.(plan.trip.path);
        await w.change(plan.trip.path, (text) => plan.rows.reduce((t, row) => tableWithRow(t, ITINERARY_TABLE, { date: row.date, time: row.time, kind: row.kind, what: row.what, until: row.until, where: row.where, booking: row.booking, cost: '', paid: '', notes: '' }), text));
        return `${plan.words} [${plan.trip.path}]`;
      }
      const plan = name === 'travel_itinerary_add' ? { ...planBooking(args, mine, cur), table: ITINERARY_TABLE } : name === 'travel_expense_add' ? { ...planExpense(args, mine, cur), table: EXPENSES_TABLE } : null;
      if (!plan) return `There is no tool called ${name}.`;
      ctx.check?.(plan.trip.path);
      await w.change(plan.trip.path, (text) => tableWithRow(text, plan.table, plan.values));
      return `${plan.words} [${plan.trip.path}]`;
    },
    rules: () => 'Trips: use travel_trip_list, travel_trip_get (the itinerary day by day, booking references, costs, documents and a passport check), travel_forecast and travel_checklist before leaving; add with travel_trip_add, travel_itinerary_add (from a confirmation the person gave), travel_import_calendar (from a calendar file the person gave) and travel_expense_add, never inventing a reference, a time, a price or a day.',
    async inbox(item) {
      const m = await model();
      const words = itemWords(item);
      const live = [...m.away, ...m.upcoming];
      let x = namedIn(words, live, (t) => [t.name, t.destination]);
      // Travel words, not booking words ("booking a dentist appointment" is no trip, 9.2).
      if (!x && live.length === 1 && /\b(flight|boarding pass|itinerary|hotel|check-?in|e-?ticket)\b/i.test(words)) x = live[0];
      if (!x) return null;
      return { target: { kind: 'module', module: 'travel', type: 'trip', path: x.path, name: x.name, label: item.kind === 'line' ? `Add to ${x.name}’s notes` : `Keep with ${x.name}` }, why: x.destination && new RegExp(`\\b${x.destination.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(words) ? `Names ${x.destination}` : `For your next trip, ${x.name}` };
    },
    async fileInbox(item, target) {
      const { m, x } = await trip(target.path);
      if (item.kind !== 'line') return { words: `Kept ${item.path.split('/').pop()} with ${x.name}.`, paths: [x.path], keepWith: x.path };
      await r.addWords(x.path, inboxLine(item, m.today));
      return { words: `Added to ${x.name}’s notes.`, paths: [x.path] };
    },
  };
}

