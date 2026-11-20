// Vendors, Quotes and Contracts on the main side (Wave 6 part b; src/shared/work-vendors.ts). Its notes are read from the
// index (the whole index for the window, an agent's gated one for its tools), every change is one property or one item's
// cell written as every save is, new notes go in the module's folder inside the Work area under a free name, and its
// notices (a quote lapsing, a contract's day to give notice or its end, an order past its delivery day) are said once.
//
//   model                    the module as the window shows it
//   set-field                one value changed where it shows
//   add-vendor / add-quote / add-order / add-contract   a new record (a quote's or contract's new vendor made too)
//   set-item / add-item / remove-item                   a quote's items (its amount follows them when it did before)
//   accept-quote / decline-quotes                       a quote accepted; the others for its project declined only if asked
//   keep-files / pick-files                             files kept beside a record
//   project                  a project's quotes, orders and contracts, and what needs attention there

import { currencyOf } from '../../shared/module-records';
import { addQuoteItem, amountAfterItems, answerVendorTool, contractName, editVendorRecord, newContractText, newOrderText, newQuoteText, newVendorText, orderName, planVendorWrite, projectVendors, quoteName, readQuoteFromText, removeQuoteItem, resolveQuote, resolveVendorProject, setQuoteItem, suggestVendorName, vendorsModel, type ContractInput, type ItemInput, type OrderInput, type QuoteInput, type VendorInput, type VendorNote, type VendorsModel } from '../../shared/work-vendors';
import { moneyWords, readIsoDay, readMoney } from '../../shared/finance';
import { setNoteProp } from '../../shared/views';
import type { VaultIndex } from '../indexer';
import type { ToolCtx, WorkModules, WorkNotice, WorkPart } from '../work-modules';

const TYPES = ['vendor', 'quote', 'purchase-order', 'contract'];

export type VendorsView = VendorsModel & { currency: string; folder: string; projects: { path: string; name: string }[] };

const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : typeof v === 'number' ? String(v) : '');
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export function makeVendors(w: WorkModules): WorkPart {
  const currency = async () => w.setting('vendors', 'currency', currencyOf(await w.options()));

  async function notes(index: VaultIndex, files = false): Promise<VendorNote[]> {
    const list = (await w.notesOf(index, TYPES)).map((n) => ({ path: n.path, title: n.title, props: n.props, content: n.content, type: n.type }) as VendorNote);
    if (files) for (const n of list) n.files = await w.filesOf(n.path);
    return list;
  }
  async function model(index: VaultIndex = w.d.index, files = false): Promise<VendorsModel> {
    return vendorsModel(await notes(index, files), w.today(), await w.remindDays('vendors'), { currency: await currency(), projects: w.d.projects() });
  }
  const today = () => w.todayIso();
  const projectName = (v: unknown) => resolveVendorProject(w.d.projects(), v);

  /** The vendor's note, made when there is none by that name yet (one home per record). A near-miss asks instead
   *  of minting a second vendor for a typo. */
  async function ensureVendor(name: string): Promise<string | null> {
    const n = name.trim();
    if (!n) return null;
    const m = await model();
    const v = m.vendors.find((x) => x.name.toLowerCase() === n.toLowerCase() && x.path);
    if (v) return null;
    const close = suggestVendorName(m.vendors.filter((x) => x.path).map((x) => x.name), n);
    if (close) throw new Error(`Did you mean "${close}"? There is no vendor called "${n}"; say which one.`);
    return w.newNote(await w.folderOf('vendor'), n, newVendorText({ name: n }));
  }

  const ops: WorkPart['ops'] = {
    model: async (): Promise<VendorsView> => {
      const m = await model(w.d.index, true);
      return { ...m, currency: await currency(), folder: await w.moduleFolder('vendors'), projects: w.d.projects() };
    },

    'set-field': async (input: unknown) => {
      const i = obj(input);
      const kind = str(i.kind, 20);
      const rel = str(i.path, 1000);
      const field = str(i.field, 40);
      if (!rel) throw new Error(kind === 'vendor' ? 'This vendor has no note of its own yet. Add it as a vendor first (New vendor), then change it here.' : 'That record isn’t there any more.');
      let said: string | null = null;
      await w.change(rel, (text) => {
        const r = editVendorRecord(text, kind, field, field === 'project' ? projectName(i.value) : i.value, today());
        said = r.words;
        return r.text;
      });
      return said;
    },

    'add-vendor': async (input: unknown) => {
      const v = obj(input) as unknown as VendorInput;
      const name = str(v.name, 80);
      if (!name) throw new Error('A vendor needs a name.');
      const m = await model();
      if (m.vendors.some((x) => x.path && x.name.toLowerCase() === name.toLowerCase())) throw new Error(`${name} is already a vendor.`);
      return w.newNote(await w.folderOf('vendor'), name, newVendorText({ ...v, name }));
    },

    'add-quote': async (input: unknown) => {
      const q = obj(input) as unknown as QuoteInput;
      const vendor = str(q.vendor, 80);
      if (!vendor) throw new Error('Say who the quote is from.');
      const reference = str(q.reference, 60);
      if (reference) {
        const dup = (await model()).quotes.find((x) => x.vendor.toLowerCase() === vendor.toLowerCase() && x.reference.toLowerCase() === reference.toLowerCase());
        if (dup) throw new Error(`There’s already a quote from ${dup.vendor} with reference ${dup.reference} [${dup.path}].`);
      }
      const amount = q.amount === undefined || q.amount === null || (q.amount as unknown) === '' ? null : readMoney(q.amount);
      const made = await ensureVendor(vendor);
      const clean: QuoteInput = { vendor, project: projectName(q.project), amount, currency: str(q.currency, 3).toUpperCase(), received: q.received ? readIsoDay(q.received) : null, validUntil: q.validUntil ? readIsoDay(q.validUntil) : null, status: str(q.status, 20) || 'Received', reference: str(q.reference, 60), version: str(q.version, 20), items: Array.isArray(q.items) ? (q.items as ItemInput[]).slice(0, 200) : [] };
      const rel = await w.newNote(await w.folderOf('quote'), quoteName(clean), newQuoteText(clean, today()));
      return { path: rel, vendor: made };
    },

    'add-order': async (input: unknown) => {
      const o = obj(input) as unknown as OrderInput & { quotePath?: string };
      let vendor = str(o.vendor, 80);
      let project = projectName(o.project);
      let amount = o.amount === undefined || o.amount === null || (o.amount as unknown) === '' ? null : readMoney(o.amount);
      let quote = str(o.quote, 120);
      // From a quote: its vendor, project and amount carried over unless given.
      if (o.quotePath) {
        const m = await model();
        const q = m.quotes.find((x) => x.path === o.quotePath);
        if (q) {
          vendor ||= q.vendor;
          project ||= q.project;
          if (amount === null) amount = q.amount;
          quote ||= q.name;
        }
      }
      if (!vendor) throw new Error('Say who the order is with.');
      if (str(o.number, 60)) {
        const dup = (await model()).orders.find((x) => x.number.toLowerCase() === str(o.number, 60).toLowerCase());
        if (dup) throw new Error(`There’s already a purchase order numbered ${dup.number} [${dup.path}].`);
      }
      await ensureVendor(vendor);
      const clean: OrderInput = { vendor, project, quote, number: str(o.number, 60), amount, raised: o.raised ? readIsoDay(o.raised) : null, delivery: o.delivery ? readIsoDay(o.delivery) : null, status: str(o.status, 20) || 'Raised' };
      return w.newNote(await w.folderOf('purchase-order'), orderName(clean), newOrderText(clean, today()));
    },

    'add-contract': async (input: unknown) => {
      const c = obj(input) as unknown as ContractInput;
      const vendor = str(c.vendor, 80);
      if (!vendor) throw new Error('Say who the contract is with.');
      const reference = str(c.reference, 60);
      if (reference) {
        const dup = (await model()).contracts.find((x) => x.vendor.toLowerCase() === vendor.toLowerCase() && x.reference.toLowerCase() === reference.toLowerCase());
        if (dup) throw new Error(`There’s already a contract with ${dup.vendor} with reference ${dup.reference} [${dup.path}].`);
      }
      const starts = c.starts ? readIsoDay(c.starts) : null;
      const ends = c.ends ? readIsoDay(c.ends) : null;
      if (starts && ends && ends < starts) throw new Error('The end day is before the start day.');
      const nd = c.noticeDays === undefined || c.noticeDays === null || (c.noticeDays as unknown) === '' ? null : Number(c.noticeDays);
      if (nd !== null && (!Number.isFinite(nd) || nd < 0)) throw new Error('Give the notice as a number of days.');
      await ensureVendor(vendor);
      const clean: ContractInput = { vendor, project: projectName(c.project), amount: c.amount === undefined || c.amount === null || (c.amount as unknown) === '' ? null : readMoney(c.amount), period: str(c.period, 20), starts, ends, noticeDays: nd === null ? null : Math.round(nd), renewal: str(c.renewal, 20), status: str(c.status, 20) || 'Active', reference: str(c.reference, 60) };
      return w.newNote(await w.folderOf('contract'), contractName(clean), newContractText(clean));
    },

    'set-item': async (rel: unknown, row: unknown, part: unknown, value: unknown) => {
      const p = str(part, 10) as 'item' | 'qty' | 'unit' | 'total';
      if (!['item', 'qty', 'unit', 'total'].includes(p) || typeof row !== 'number') throw new Error('That can’t be changed here.');
      return itemsChange(str(rel, 1000), (text) => setQuoteItem(text, row, p, value));
    },
    'add-item': async (rel: unknown, input: unknown) => itemsChange(str(rel, 1000), (text) => addQuoteItem(text, obj(input) as ItemInput)),
    'remove-item': async (rel: unknown, row: unknown) => {
      if (typeof row !== 'number') throw new Error('That item isn’t there any more.');
      return itemsChange(str(rel, 1000), (text) => removeQuoteItem(text, row));
    },

    'accept-quote': async (rel: unknown) => {
      const path = str(rel, 1000);
      const m = await model();
      const q = m.quotes.find((x) => x.path === path);
      if (!q) throw new Error('That quote isn’t there any more.');
      await w.change(path, (text) => setNoteProp(text, 'status', 'Accepted'));
      // The others for the same project are only offered (the window asks); never declined here.
      const others = q.project ? m.quotes.filter((x) => x.path !== path && x.open && x.project.toLowerCase() === q.project.toLowerCase()).map((x) => ({ path: x.path, vendor: x.vendor, name: x.name })) : [];
      return { words: `Accepted ${q.vendor ? `${q.vendor}’s quote` : q.name}${q.amount !== null ? ` (${moneyWords(q.amount, q.currency)})` : ''}.`, others };
    },
    'decline-quotes': async (rels: unknown) => {
      const list = Array.isArray(rels) ? rels.filter((r): r is string => typeof r === 'string').slice(0, 50) : [];
      let n = 0;
      for (const r of list) if (await w.change(r, (text) => setNoteProp(text, 'status', 'Declined'))) n++;
      return `${n} ${n === 1 ? 'quote' : 'quotes'} marked declined.`;
    },

    'keep-files': async (rel: unknown, files: unknown) => {
      const added = await w.keepFiles(str(rel, 1000), Array.isArray(files) ? files.filter((f): f is string => typeof f === 'string') : []);
      return added;
    },
    'pick-files': async (title: unknown) => w.pickFiles(str(title, 120)),

    project: async (projectPath: unknown) => {
      const path = str(projectPath, 1000);
      const p = w.d.projects().find((x) => x.path === path);
      if (!p) return { tile: null, attention: [] };
      return projectVendors(await model(), p, await currency());
    },
  };

  /** A quote's items changed: one write, its amount following the items when it did before. */
  async function itemsChange(rel: string, change: (text: string) => string): Promise<string | null> {
    let said: string | null = null;
    await w.change(rel, (text) => {
      let next = change(text);
      const amount = amountAfterItems(text, next);
      if (amount !== null) {
        next = setNoteProp(next, 'amount', amount);
        said = `The quote’s amount follows its items: ${moneyWords(amount)}.`;
      }
      return next;
    });
    return said;
  }

  async function check(): Promise<WorkNotice[]> {
    const m = await model();
    const out: WorkNotice[] = [];
    for (const a of m.attention) {
      if (a.kind === 'contract' && !w.part('vendors', 'contracts')) continue;
      if (a.kind === 'order' && !w.part('vendors', 'orders')) continue;
      out.push({ key: a.key, kind: 'vendors', title: a.words, body: a.sub, path: a.path });
    }
    return out;
  }

  async function tool(name: string, args: Record<string, unknown>, ctx: ToolCtx): Promise<string> {
    const cur = await currency();
    if (name === 'quote_accept' || name === 'quote_extend') {
      const mine = await model(ctx.gated);
      const found = resolveQuote(mine.quotes, str(args.quote, 200), str(args.project) || undefined);
      if (!found.quote && !found.candidates.length) throw new Error(`There is no quote called “${str(args.quote, 200)}” in Vendors.`);
      if (!found.quote) return `More than one quote matches “${str(args.quote, 200)}”: ${found.candidates.map((x) => x.name).join('; ')}. Say which one.`;
      const q = found.quote;
      ctx.check?.(q.path);
      if (name === 'quote_extend') {
        const until = readIsoDay(args.valid_until);
        if (!until) throw new Error('Give the new day it is valid until as YYYY-MM-DD.');
        if (q.validUntil && until <= q.validUntil) throw new Error(`That is not later than the day it is valid until now (${q.validUntil}).`);
        await w.change(q.path, (text) => setNoteProp(text, 'valid_until', until));
        return `Extended ${q.vendor ? `${q.vendor}’s quote` : q.name} to ${until}. [${q.path}]`;
      }
      if (/^accepted$/i.test(q.status)) return `${q.vendor ? `${q.vendor}’s quote` : q.name} is accepted already. [${q.path}]`;
      await w.change(q.path, (text) => setNoteProp(text, 'status', 'Accepted'));
      const others = q.project ? mine.quotes.filter((x) => x.path !== q.path && x.open && x.project.toLowerCase() === q.project.toLowerCase()) : [];
      return `Accepted ${q.vendor ? `${q.vendor}’s quote` : q.name}${q.amount !== null ? ` (${moneyWords(q.amount, q.currency)})` : ''}.${others.length ? ` Still open for ${q.project}: ${others.map((x) => x.vendor || x.name).join(', ')}. They are not declined: say if they should be.` : ''} [${q.path}]`;
    }
    const write = name === 'quote_add' || name === 'quote_add_from_text' || name === 'contract_add' || name === 'vendor_add' || name === 'purchase_order_add';
    if (!write) {
      const mine = await notes(ctx.gated);
      const all = ctx.gated === w.d.index ? mine : await notes(w.d.index);
      const m = vendorsModel(mine, w.today(), await w.remindDays('vendors'), { currency: cur, projects: w.d.projects() });
      return answerVendorTool({ model: m, currency: cur, refused: all.length - mine.length, agent: ctx.agent }, name, args) ?? `There is no tool called ${name}.`;
    }
    const m = await model();
    let readWords = '';
    let toolName = name;
    let toolArgs = args;
    if (name === 'quote_add_from_text') {
      const parsed = readQuoteFromText(str(args.text, 100000));
      const vendor = str(args.vendor, 80) || parsed.vendor;
      if (!vendor) throw new Error('The words do not say who the quote is from. Say who sent it.');
      toolName = 'quote_add';
      toolArgs = { vendor, project: args.project, amount: parsed.amount ?? undefined, valid_until: parsed.validUntil ?? undefined, reference: parsed.reference || undefined, items: parsed.items };
      readWords = parsed.found.length ? ` Read from the words: ${parsed.found.join(', ')}. Check them once.` : ' Nothing plain could be read from the words; check the quote.';
    }
    const plan = planVendorWrite(toolName, { ...toolArgs, project: projectName(toolArgs.project) }, { folders: { vendor: await w.folderOf('vendor'), quote: await w.folderOf('quote'), contract: await w.folderOf('contract'), order: await w.folderOf('purchase-order') }, vendors: m.vendors.filter((v) => v.path).map((v) => v.name), today: today(), currency: cur });
    const rel = await w.freeNote(plan.folder, plan.name);
    ctx.check?.(rel);
    let vrel: string | null = null;
    if (plan.vendor) {
      vrel = await w.freeNote(plan.vendor.folder, plan.vendor.name);
      ctx.check?.(vrel);
    }
    await w.d.requireCreate();
    if (plan.vendor && vrel) await w.d.writeNote(vrel, plan.vendor.text);
    await w.d.writeNote(rel, plan.text);
    return `${plan.words}${readWords} [${rel}]`;
  }

  return {
    id: 'vendors',
    ops,
    check,
    tool,
    rules: () => 'Suppliers: use vendor_list, quote_list, quote_compare and contract_expiring for suppliers, quotes, what lapses and what ends; add a vendor with vendor_add, a quote with quote_add (or quote_add_from_text from a quote file’s words, saying what was read for the person to check), a purchase order with purchase_order_add or a contract with contract_add, accept a quote with quote_accept (the others are named, never declined) and extend one with quote_extend, only with the amounts and days the person gave (never guess either). These records are Work-confidential.',
  };
}

