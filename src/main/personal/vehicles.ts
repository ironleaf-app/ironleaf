// Vehicles on the main side (Wave 7 part a; src/shared/vehicles.ts). Its notes read from the index, each change one
// property or one cell of a fuel log or service history (every other character kept), a fill-up or a service added as a
// row, a renewal moving its day on, papers kept beside a vehicle, the bell told of rego, insurance and servicing coming
// up (each said once), the Inbox's fill-ups and papers filed, and its tools through each agent's gate.

import { partOn } from '../../shared/life-modules';
import { answerVehicleTool, FUEL_TABLE, nextService, newVehicleText, planFuelAdd, planRenewed, planServiceAdd, planTripAdd, planVehicleAdd, SERVICE_TABLE, TRIP_TABLE, VEHICLE_CELL, VEHICLE_PROPS, VEHICLE_TABLES, vehicleName, vehiclesModel, type VehicleInput, type VehiclesModel } from '../../shared/vehicles';
import { dayWords, readAmount, readDay, readNumber, tableWithRow } from '../../shared/personal-records';
import type { VaultIndex } from '../indexer';
import type { WorkModules, WorkNotice } from '../work-modules';
import { inboxLine, itemWords, namedIn, personalRecords, S, withProps, remindDaysOption, type PersonalPart } from './common';

export type VehiclesView = VehiclesModel & { folder: string; currency: string; serviceMonths: number; serviceKm: number };

const TYPES = ['vehicle'];

export function makeVehicles(w: WorkModules): PersonalPart {
  const r = personalRecords(w, {
    module: 'vehicles',
    types: TYPES,
    tables: VEHICLE_TABLES,
    props: { vehicle: VEHICLE_PROPS },
    cells: { fuel: { table: FUEL_TABLE }, servicing: { table: SERVICE_TABLE, map: VEHICLE_CELL.servicing }, trip: { table: TRIP_TABLE } },
  });
  const model = async (index: VaultIndex = w.d.index): Promise<VehiclesModel> => vehiclesModel(await r.notes(index), w.today(), await w.remindDays('vehicles'));
  const every = async () => ({ months: Math.max(1, Math.min(36, await w.setting('vehicles', 'serviceMonths', 12))), km: Math.max(0, Math.min(100000, await w.setting('vehicles', 'serviceKm', 10000))) });
  const view = async (): Promise<VehiclesView> => {
    const e = await every();
    return { ...(await model()), folder: await w.moduleFolder('vehicles'), currency: await r.currency(), serviceMonths: e.months, serviceKm: e.km };
  };

  const addVehicle = async (input: unknown): Promise<string> => {
    const i = (input ?? {}) as VehicleInput & { name?: string };
    for (const k of ['rego_due', 'insurance_due', 'service_due'] as const) if (S(i[k]) && !readDay(i[k])) throw new Error('Give days like 2027-03-31.');
    const clean: VehicleInput = { kind: S(i.kind, 40) || 'Car', make: S(i.make, 60), model: S(i.model, 60), year: S(i.year, 4), rego: S(i.rego, 20), rego_due: readDay(i.rego_due), insurer: S(i.insurer, 60), insurance_due: readDay(i.insurance_due), service_due: readDay(i.service_due), service_km: S(i.service_km, 10), fuel: S(i.fuel, 30), odometer: S(i.odometer, 10) };
    const name = S(i.name, 80) || vehicleName(clean);
    if (!S(i.name, 80) && !clean.make && !clean.model && !clean.rego) throw new Error('Give the vehicle a name, or its make and model.');
    const m = await model();
    if (m.vehicles.some((v) => v.name.toLowerCase() === name.toLowerCase())) throw new Error(`There’s already a vehicle called ${name}.`);
    return w.newNote(await w.folderOf('vehicle'), name, newVehicleText(clean));
  };

  /** A fill-up added from the page (the same checks as the tool's). */
  const fuelEnabled = () => partOn(w.d.prefs().modules, 'vehicles', 'fuel');
  const requireFuel = () => {
    if (!fuelEnabled()) throw new Error('Turn on Fuel log in Settings › Packs › Cars to log fuel.');
  };
  const addFill = async (rel: unknown, input: unknown): Promise<string> => {
    requireFuel();
    const m = await model();
    const v = m.vehicles.find((x) => x.path === S(rel, 1000));
    if (!v) throw new Error('That vehicle isn’t there any more.');
    const plan = planFuelAdd({ ...(input as Record<string, unknown>), vehicle: v.name }, { ...m, vehicles: [v] }, await r.currency());
    await w.change(v.path, (text) => tableWithRow(text, FUEL_TABLE, plan.values));
    return plan.words;
  };

  /** A service added from the page: its row, and the next service's day and km. */
  const addService = async (rel: unknown, input: unknown): Promise<string> => {
    const m = await model();
    const v = m.vehicles.find((x) => x.path === S(rel, 1000));
    if (!v) throw new Error('That vehicle isn’t there any more.');
    const plan = planServiceAdd({ ...(input as Record<string, unknown>), vehicle: v.name }, { ...m, vehicles: [v] }, await r.currency());
    await w.change(v.path, (text) => withProps(tableWithRow(text, SERVICE_TABLE, plan.values), plan.props ?? {}));
    return plan.words;
  };

  const renewed = async (rel: unknown, what: unknown, until: unknown): Promise<string> => {
    const m = await model();
    const v = m.vehicles.find((x) => x.path === S(rel, 1000));
    if (!v) throw new Error('That vehicle isn’t there any more.');
    const plan = planRenewed({ vehicle: v.name, what, until }, { ...m, vehicles: [v] });
    await r.setProps(v.path, plan.props);
    return plan.words;
  };

  const ops: PersonalPart['ops'] = {
    ...r.fileOps,
    'add-row': (rel, table, values) => {
      if (table === 'fuel') requireFuel();
      return r.addRow(rel, table, values);
    },
    'set-field': (input) => {
      if ((input as { kind?: unknown } | null)?.kind === 'fuel') requireFuel();
      return r.setField(input);
    },
    'remove-row': (rel, table, row, shown) => {
      if (table === 'fuel') requireFuel();
      return r.removeRow(rel, table, row, shown);
    },
    model: () => view(),
    'add-vehicle': (input) => addVehicle(input),
    'add-fill': (rel, input) => addFill(rel, input),
    'add-service': (rel, input) => addService(rel, input),
    'add-trip': async (rel: unknown, input: unknown) => {
      const m = await model();
      const v = m.vehicles.find((x) => x.path === S(rel, 1000));
      if (!v) throw new Error('That vehicle isn’t there any more.');
      const plan = planTripAdd({ ...(input as Record<string, unknown>), vehicle: v.name }, { ...m, vehicles: [v] });
      await w.change(v.path, (text) => tableWithRow(text, TRIP_TABLE, plan.values));
      return plan.words;
    },
    renewed: (rel, what, until) => renewed(rel, what, until),
    'next-service': async (date, odometer) => nextService({ date: readDay(date) ?? w.todayIso(), odometer: readNumber(odometer) }, await every()),
    options: async (patch) => {
      const p = (patch && typeof patch === 'object' ? patch : {}) as Record<string, unknown>;
      const remindDays = await remindDaysOption(w, 'vehicles', patch);
      const settings: Record<string, string | number> = {};
      if (typeof p.serviceMonths === 'number') settings.serviceMonths = Math.max(1, Math.min(36, Math.round(p.serviceMonths)));
      if (typeof p.serviceKm === 'number') settings.serviceKm = Math.max(0, Math.min(100000, Math.round(p.serviceKm)));
      if (typeof p.currency === 'string') settings.currency = /^[A-Z]{3}$/.test(p.currency) ? p.currency : '';
      if (Object.keys(settings).length) await w.setOptions('vehicles', { settings });
      const e = await every();
      return { remindDays, serviceMonths: e.months, serviceKm: e.km, currency: await r.currency() };
    },
  };

  return {
    id: 'vehicles',
    ops,
    async check(): Promise<WorkNotice[]> {
      if (!partOn(w.d.prefs().modules, 'vehicles', 'reminders')) return [];
      const m = await model();
      return m.due.map((d) => ({
        key: `vehicle-due:${d.vehicle.path}:${d.what}:${d.date ?? ''}:${d.kmLeft !== null && d.kmLeft < 0 ? 'km-late' : d.kmLeft !== null && d.kmLeft <= 1000 ? 'km-soon' : ''}${d.late ? ':late' : ''}`,
        kind: 'vehicles',
        title: `${d.vehicle.name}: ${d.words.charAt(0).toLowerCase()}${d.words.slice(1)}`,
        body: [d.vehicle.rego, d.what === 'insurance' && d.vehicle.insurer, d.date && dayWords(d.date, m.today)].filter(Boolean).join(' · '),
        path: d.vehicle.path,
      }));
    },
    async tool(name, args, ctx) {
      if (name === 'vehicle_fuel_add' || name === 'vehicle_fuel_trend') requireFuel();
      const mine = await model(ctx.gated);
      const refused = await r.refused(ctx, mine.vehicles.length);
      const cur = await r.currency();
      const on = w.isOn('vehicles');
      const read = answerVehicleTool({ model: mine, on, refused, agent: ctx.agent, currency: cur }, name, args);
      if (read !== null) return read;
      if (name === 'vehicle_add') {
        const made = planVehicleAdd(args, { on, model: mine });
        const rel = await w.freeNote(await w.folderOf('vehicle'), made.name);
        ctx.check?.(rel);
        await w.d.requireCreate();
        await w.d.writeNote(rel, made.text);
        return `${made.words} [${rel}]`;
      }
      if (name === 'vehicle_renewed') {
        const plan = planRenewed(args, mine);
        ctx.check?.(plan.path);
        await r.setProps(plan.path, plan.props);
        return `${plan.words} [${plan.path}]`;
      }
      const plan = name === 'vehicle_fuel_add' ? planFuelAdd(args, mine, cur) : name === 'vehicle_service_add' ? planServiceAdd(args, mine, cur) : name === 'vehicle_trip_add' ? planTripAdd(args, mine) : null;
      if (!plan) return `There is no tool called ${name}.`;
      ctx.check?.(plan.path);
      await w.change(plan.path, (text) => withProps(tableWithRow(text, plan.table, plan.values), plan.props ?? {}));
      return `${plan.words} [${plan.path}]`;
    },
    rules: () => 'Cars: use vehicle_list, vehicle_due (rego, insurance and service by day or km), vehicle_fuel_trend (fuel or energy use between full tanks or charges, spend by month) and vehicle_distance (trips and kilometres per financial year, for tax time); add a vehicle with vehicle_add; log a fill-up with vehicle_fuel_add, a trip with vehicle_trip_add, a service with vehicle_service_add and a renewal with vehicle_renewed only with the numbers and days the person gave (never guess an odometer, litres, a cost, kilometres or a day).',
    async inbox(item) {
      const m = await model();
      const words = itemWords(item);
      const live = m.vehicles.filter((v) => v.status !== 'Sold');
      let v = namedIn(words, live, (x) => [x.name, x.rego, `${x.make} ${x.model}`, x.model]);
      // A fill-up: litres and money, and the vehicle named or fuel words said ("20L of paint $45" is paint, 9.2).
      const litresMoney = /\b\d+(?:\.\d+)?\s*(?:l|litres|liters|kwh)\b/i.test(words) && /\$\s?\d|\b\d+\.\d{2}\b/.test(words);
      const fuelish = fuelEnabled() && litresMoney && !/\bpaint\b/i.test(words) && (!!v || /\b(fuel|petrol|diesel|fill(?:ed|ing)?(?:\s+up)?|servo|service station|gas station|unleaded|e10|charge|charging|bp\b|shell|caltex|ampol|mobil|gull|\bz\b|waitomo|allied|gaspy)\b/i.test(words));
      if (!v && fuelish && live.length === 1) v = live[0];
      if (!v) return null;
      if (item.kind === 'line' && fuelish) {
        const litres = readNumber(/(\d+(?:\.\d+)?)\s*(?:l|litres|liters|kwh)\b/i.exec(words)?.[1]);
        const cost = readAmount(/\$\s?(\d[\d,]*(?:\.\d{2})?)/.exec(words)?.[1] ?? /\b(\d+\.\d{2})\b/.exec(words)?.[1]);
        return { target: { kind: 'module', module: 'vehicles', type: 'fuel', path: v.path, name: v.name, label: `Log a fill-up for ${v.name}` }, why: `A fill-up: ${[litres !== null ? `${litres} ${v.unit}` : '', cost !== null ? `$${cost.toFixed(2)}` : ''].filter(Boolean).join(', ')}` };
      }
      return { target: { kind: 'module', module: 'vehicles', type: 'vehicle', path: v.path, name: v.name, label: item.kind === 'line' ? `Add to ${v.name}’s notes` : `Keep with ${v.name}` }, why: `Names ${v.name}` };
    },
    async fileInbox(item, target) {
      const m = await model();
      const v = m.vehicles.find((x) => x.path === target.path);
      if (!v) throw new Error('That vehicle isn’t there any more.');
      if (item.kind !== 'line') return { words: `Kept ${item.path.split('/').pop()} with ${v.name}.`, paths: [v.path], keepWith: v.path };
      if (target.type === 'fuel') {
        requireFuel();
        const words = item.words;
        const date = readDay(/\b(\d{4}-\d{2}-\d{2})\b/.exec(words)?.[1]) ?? (item.stamp ? readDay(item.stamp.replace(/\s+\d{1,2}:\d{2}.*$/, '')) : null) ?? m.today;
        const odo = readNumber(/(\d[\d,]{3,})\s*km\b/i.exec(words)?.[1]);
        const litres = readNumber(/(\d+(?:\.\d+)?)\s*(?:l|litres|liters|kwh)\b/i.exec(words)?.[1]);
        const cost = readAmount(/\$\s?(\d[\d,]*(?:\.\d{2})?)/.exec(words)?.[1] ?? /\b(\d+\.\d{2})\b/.exec(words)?.[1]);
        const plan = planFuelAdd({ vehicle: v.name, date, odometer: odo ?? undefined, litres: litres ?? undefined, cost: cost ?? undefined, full: !/\b(part|top.?up|half)\b/i.test(words) }, { ...m, vehicles: [v] }, await r.currency());
        await w.change(v.path, (text) => tableWithRow(text, FUEL_TABLE, plan.values));
        return { words: plan.words, paths: [v.path] };
      }
      await r.addWords(v.path, inboxLine(item, m.today));
      return { words: `Added to ${v.name}’s notes.`, paths: [v.path] };
    },
  };
}

