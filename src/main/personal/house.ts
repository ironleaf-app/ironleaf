// Home on the main side (Wave 7 part a; src/shared/house.ts). Its notes read from the index, each change one property or
// one cell of a home's rooms, utilities or network notes, an appliance's service history or a job's Done list (every
// other character kept), a job marked done moving its next day on, manuals kept beside an appliance, the bell told of
// maintenance due and warranties ending (each said once), the Inbox's manuals and receipts filed, and its tools through
// each agent's gate.

import { partOn } from '../../shared/life-modules';
import { answerHouseTool, APPLIANCE_PROPS, applianceName, doneChange, DONE_TABLE, HISTORY_TABLE, HOME_PROPS, HOUSE_CELL, HOUSE_TABLES, houseModel, jobWords, NETWORK_TABLE, newApplianceText, newHomeText, newJobText, planApplianceAdd, planJobAdd, planSeasonalPack, ROOMS_TABLE, UPKEEP_PROPS, UTILITIES_TABLE, warrantyWords, type ApplianceInput, type HomeInput, type HouseModel, type JobInput } from '../../shared/house';
import { dayWords, readAmount, readDay, tableWithRow } from '../../shared/personal-records';
import type { VaultIndex } from '../indexer';
import type { WorkModules, WorkNotice } from '../work-modules';
import { inboxLine, itemWords, namedIn, personalRecords, S, withProps, remindDaysOption, type PersonalPart } from './common';

export type HouseView = HouseModel & { folder: string; currency: string; people: string[] };

const TYPES = ['house', 'appliance', 'upkeep'];

export function makeHouse(w: WorkModules): PersonalPart {
  const r = personalRecords(w, {
    module: 'house',
    types: TYPES,
    tables: HOUSE_TABLES,
    props: { appliance: APPLIANCE_PROPS, upkeep: UPKEEP_PROPS, house: HOME_PROPS },
    cells: { room: { table: ROOMS_TABLE, map: HOUSE_CELL.room }, utility: { table: UTILITIES_TABLE, map: HOUSE_CELL.utility }, network: { table: NETWORK_TABLE }, history: { table: HISTORY_TABLE }, done: { table: DONE_TABLE } },
  });
  const jobDays = () => w.setting('house', 'jobDays', 14);
  const model = async (index: VaultIndex = w.d.index): Promise<HouseModel> => houseModel(await r.notes(index), w.today(), await w.remindDays('house'), Math.max(0, Math.min(90, await jobDays())));
  const view = async (): Promise<HouseView> => {
    const m = await model();
    // The power row and the Finance bill are the one bill: when Finance is on, its bills ride along so the row can point at them (30 Oct 2026).
    if (w.isOn('finance')) m.bills = (await w.notesOf(w.d.index, ['bill'])).map((n) => ({ name: n.title, due: readDay(n.props.due), amount: readAmount(n.props.amount) }));
    return { ...m, folder: await w.moduleFolder('house'), currency: await r.currency(), people: (await r.people()).map((p) => p.name) };
  };

  const addHome = async (input: unknown): Promise<string> => {
    const i = (input ?? {}) as HomeInput & { name?: string };
    const name = S(i.name, 80) || 'Home';
    const m = await model();
    if (m.homes.some((h) => h.name.toLowerCase() === name.toLowerCase())) throw new Error(`There’s already a home called ${name}.`);
    if (S(i.moved_in) && !readDay(i.moved_in)) throw new Error('Give the day you moved in like 2024-02-01.');
    return w.newNote(await w.folderOf('house'), name, newHomeText({ address: S(i.address, 200), ownership: S(i.ownership, 20), moved_in: readDay(i.moved_in) }));
  };

  const addAppliance = async (input: unknown): Promise<string> => {
    const i = (input ?? {}) as ApplianceInput & { name?: string };
    for (const k of ['purchased', 'warranty'] as const) if (S(i[k]) && !readDay(i[k])) throw new Error('Give days like 2027-03-31.');
    const clean: ApplianceInput = { kind: S(i.kind, 40) || 'Other', room: S(i.room, 60), make: S(i.make, 60), model: S(i.model, 60), serial: S(i.serial, 60), purchased: readDay(i.purchased), price: readAmount(i.price), supplier: S(i.supplier, 80), warranty: readDay(i.warranty) };
    const m = await model();
    if (!S(i.name) && clean.kind === 'Other' && !clean.room && !clean.make && !clean.model && !clean.serial && !clean.warranty && !clean.purchased && !clean.supplier && clean.price == null) throw new Error('Give the appliance a name, kind, room or identifying detail.');
    if (clean.serial && m.appliances.some((a) => a.serial.toLowerCase() === clean.serial!.toLowerCase())) throw new Error(`An appliance with serial ${clean.serial} is already here.`);
    return w.newNote(await w.folderOf('appliance'), S(i.name, 80) || applianceName(clean), newApplianceText(clean));
  };

  const addJob = async (input: unknown): Promise<string> => {
    const i = (input ?? {}) as JobInput & { name?: string };
    const name = S(i.name, 100);
    if (!name) throw new Error('Say what the job is (“Clean the gutters”).');
    for (const k of ['last_done', 'next_due'] as const) if (S(i[k]) && !readDay(i[k])) throw new Error('Give days like 2027-03-31.');
    const m = await model();
    if (m.jobs.some((j) => j.name.toLowerCase() === name.toLowerCase())) throw new Error(`There’s already a job called ${name}.`);
    return w.newNote(await w.folderOf('upkeep'), name, newJobText({ every: S(i.every, 30), last_done: readDay(i.last_done), next_due: readDay(i.next_due), appliance: S(i.appliance, 100), room: S(i.room, 60), who: S(i.who, 80), cost: readAmount(i.cost) }));
  };

  /** A job marked done (today unless a day is given): its last and next days, and a row in its Done list. */
  const markDone = async (rel: unknown, input: unknown): Promise<string> => {
    const m = await model();
    const j = m.jobs.find((x) => x.path === S(rel, 1000));
    if (!j) throw new Error('That job isn’t there any more.');
    const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
    const date = S(o.date) ? readDay(o.date) : m.today;
    if (!date) throw new Error('Give the day it was done like 2026-10-24.');
    const c = doneChange(j, { date, by: S(o.by, 80), cost: readAmount(o.cost), notes: S(o.notes, 200) });
    await w.change(j.path, (text) => withProps(tableWithRow(text, DONE_TABLE, c.row), c.props));
    return c.props.next_due ? `Marked “${j.name}” done. Next due ${dayWords(c.props.next_due, m.today)}.` : `Marked “${j.name}” done.`;
  };

  const ops: PersonalPart['ops'] = {
    ...r.fileOps,
    model: () => view(),
    'add-home': (input) => addHome(input),
    'add-appliance': (input) => addAppliance(input),
    'add-job': (input) => addJob(input),
    'mark-done': (rel, input) => markDone(rel, input),
    'add-seasonal-pack': async (packId: unknown) => {
      const m = await model();
      const plan = planSeasonalPack(S(packId, 40), m.today, m.jobs.map((j) => j.name));
      for (const j of plan.jobs) await w.newNote(await w.folderOf('upkeep'), j.name, newJobText(j));
      return plan.jobs.length ? `Added the ${plan.pack} starter pack: ${plan.jobs.map((j) => j.name).join(', ')}${plan.skipped.length ? ` (${plan.skipped.join(', ')} already there)` : ''}.` : `The ${plan.pack} jobs are already there.`;
    },
    options: async (patch) => {
      const p = (patch && typeof patch === 'object' ? patch : {}) as Record<string, unknown>;
      const remindDays = await remindDaysOption(w, 'house', patch);
      if (typeof p.jobDays === 'number') await w.setOptions('house', { settings: { jobDays: Math.max(0, Math.min(90, Math.round(p.jobDays))) } });
      return { remindDays, jobDays: await jobDays() };
    },
  };

  return {
    id: 'house',
    ops,
    async check(): Promise<WorkNotice[]> {
      const sw = w.d.prefs().modules;
      const m = await model();
      const out: WorkNotice[] = [];
      if (partOn(sw, 'house', 'maintenance'))
        for (const j of m.due.filter((x) => x.days !== null && x.days <= 0))
          out.push({ key: `house-job:${j.path}:${j.nextDue}`, kind: 'house', title: `${j.name} ${j.days === 0 ? 'is due today' : 'is overdue'}`, body: [jobWords(j, m.today), j.lastDone && `last done ${dayWords(j.lastDone, m.today)}`, j.who].filter(Boolean).join(' · '), path: j.path });
      if (partOn(sw, 'house', 'warranties'))
        for (const a of m.warranties.filter((x) => (x.warrantyDays ?? -1) >= 0))
          out.push({ key: `house-warranty:${a.path}:${a.warranty}`, kind: 'house', title: `${a.name}’s warranty ends ${a.warrantyDays === 0 ? 'today' : `in ${a.warrantyDays} days`}`, body: [a.room, a.serial && `serial ${a.serial}`, warrantyWords(a, m.today)].filter(Boolean).join(' · '), path: a.path });
      return out;
    },
    async tool(name, args, ctx) {
      const mine = await model(ctx.gated);
      const refused = await r.refused(ctx, mine.homes.length + mine.appliances.length + mine.jobs.length);
      const on = w.isOn('house');
      const read = answerHouseTool({ model: mine, on, refused, agent: ctx.agent, currency: await r.currency() }, name, args);
      if (read !== null) return read;
      if (name === 'home_seasonal_pack') {
        const plan = planSeasonalPack(S(args.pack, 40), mine.today, mine.jobs.map((j) => j.name));
        await w.d.requireCreate();
        for (const j of plan.jobs) {
          const rel = await w.freeNote(await w.folderOf('upkeep'), j.name);
          ctx.check?.(rel);
          await w.d.writeNote(rel, newJobText(j));
        }
        return plan.jobs.length ? `Added the ${plan.pack} starter pack: ${plan.jobs.map((j) => j.name).join(', ')}${plan.skipped.length ? ` (${plan.skipped.join(', ')} already there)` : ''}.` : `The ${plan.pack} jobs are already in House.`;
      }
      if (name === 'home_maintenance_done') {
        const j = mine.jobs.find((x) => x.name.toLowerCase() === S(args.job).toLowerCase()) ?? mine.jobs.find((x) => x.name.toLowerCase().includes(S(args.job).toLowerCase()) && S(args.job));
        if (!j) return `There is no maintenance job called “${S(args.job)}” in House.${mine.jobs.length ? ` Jobs: ${mine.jobs.map((x) => x.name).join(', ')}.` : ''}`;
        if (S(args.date) && !readDay(args.date)) return 'Give the day as YYYY-MM-DD.';
        ctx.check?.(j.path);
        return `${await markDone(j.path, { date: args.date, by: args.by, cost: args.cost, notes: args.note })} [${j.path}]`;
      }
      const plan = name === 'home_appliance_add' ? { ...planApplianceAdd(args, mine), type: 'appliance' } : name === 'home_maintenance_add' ? { ...planJobAdd(args, mine), type: 'upkeep' } : null;
      if (!plan) return `There is no tool called ${name}.`;
      const rel = await w.freeNote(await w.folderOf(plan.type), plan.name);
      ctx.check?.(rel);
      await w.d.requireCreate();
      await w.d.writeNote(rel, plan.text);
      return `${plan.words} [${rel}]`;
    },
    rules: () => 'House: use home_info (address, rooms, utilities, printer and network notes; passwords are in Secrets, never in an answer), home_appliance_find (model, serial, warranty, manuals, service history) and home_maintenance_due (with the claim or extend steps when a warranty is near its end); add with home_appliance_add and home_maintenance_add, add a season’s jobs with home_seasonal_pack, and mark a job done with home_maintenance_done, only with what the person gave (never guess a serial, a price or a day).',
    async inbox(item) {
      const m = await model();
      const words = itemWords(item);
      const a = namedIn(words, m.appliances, (x) => [x.name, `${x.make} ${x.model}`, x.model, x.serial]);
      if (a) return { target: { kind: 'module', module: 'house', type: 'appliance', path: a.path, name: a.name, label: item.kind === 'line' ? `Add to the ${a.name}’s notes` : `Keep with the ${a.name}` }, why: /manual|guide|instructions/i.test(words) ? `Its manual: ${a.name}` : /receipt|invoice|warranty/i.test(words) ? `Its receipt or warranty: ${a.name}` : `Names ${a.name}` };
      const j = namedIn(words, m.jobs, (x) => [x.name]);
      if (j && item.kind === 'line') return { target: { kind: 'module', module: 'house', type: 'upkeep', path: j.path, name: j.name, label: `Add to “${j.name}”` }, why: `Names ${j.name}` };
      return null;
    },
    async fileInbox(item, target) {
      const m = await model();
      const rec = m.appliances.find((x) => x.path === target.path) ?? m.jobs.find((x) => x.path === target.path);
      if (!rec) throw new Error('That record isn’t there any more.');
      if (item.kind !== 'line') return { words: `Kept ${item.path.split('/').pop()} with the ${rec.name}.`, paths: [rec.path], keepWith: rec.path };
      await r.addWords(rec.path, inboxLine(item, m.today));
      return { words: `Added to ${rec.name}’s notes.`, paths: [rec.path] };
    },
  };
}
