// node --test tests/work-vendors.test.mjs — Vendors, Quotes and Contracts (Wave 6 part b): records read from plain notes
// (src/shared/work-vendors.ts), a quote's validity, a contract's notice and end (auto-renewal rolling on), what needs
// attention, quotes compared item by item, the records for the views, one property or one item's cell changed, new
// notes, the agents' tools and their write plans, and the main side (src/main/work/vendors.ts through
// src/main/work-modules.ts) with a real gate, notices said once and nothing when switched off. Made-up "Harbour Retail"
// vendors and amounts only; a fixed day (Sat 24 Oct 2026).
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-vendors-'));
let S;
let M;
const TODAY = new Date(2026, 9, 24, 10, 0);
const T = '2026-10-24';
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'shared.ts');
  writeFileSync(entry, ['work-vendors', 'sensitivity', 'record-views', 'module-records'].map((m) => `export * as ${m.replace(/-(\w)/g, (_, c) => c.toUpperCase())} from ${JSON.stringify(path.join(root, 'src/shared', `${m}.ts`))};`).join('\n'));
  await build({ input: entry, platform: 'node', external: ['yaml'], output: { file: path.join(work, 's.mjs'), format: 'esm' }, logLevel: 'silent' });
  const main = path.join(work, 'main.ts');
  writeFileSync(main, [`export * from ${JSON.stringify(path.join(root, 'src/main/work-modules.ts'))};`, `export { VaultIndex } from ${JSON.stringify(path.join(root, 'src/main/indexer.ts'))};`, `export { makeGate } from ${JSON.stringify(path.join(root, 'src/main/agent-gate.ts'))};`].join('\n'));
  await build({ input: main, platform: 'node', external: ['yaml', 'electron'], output: { file: path.join(work, 'm.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try {
    symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction');
  } catch {}
  S = await import(pathToFileURL(path.join(work, 's.mjs')).href);
  M = await import(pathToFileURL(path.join(work, 'm.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const fm = (type, p) => `---\ntype: ${type}\n${Object.entries(p).map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n`;
const QUOTE_ITEMS = '## Items\n\n| Item | Qty | Unit price | Total |\n| --- | --- | --- | --- |\n| Ceiling speakers | 8 | 450 | 3600 |\n| Install labour | 1 | 2200 | 2200 |\n\n## Notes\n\nCall before ordering.\n';
const note = (p, type, text, title) => {
  const props = {};
  for (const l of (/^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? '').split('\n')) {
    const m = /^([a-z_]+):\s*(.*)$/.exec(l);
    if (m) props[m[1]] = m[2].replace(/^"|"$/g, '');
  }
  return { path: p, title: title ?? p.split('/').pop().replace(/\.md$/, ''), props, content: text, type };
};
const F = 'Work/Vendors and Contracts';
function fixtures() {
  return [
    note(`${F}/Vendors/Northwind Builders.md`, 'vendor', fm('vendor', { category: 'AV', contact: '"[[Sam Taylor]]"', email: 'sam@northwind.example', status: 'Preferred' }) + '## Notes\n'),
    note(`${F}/Vendors/Bluegum Telco.md`, 'vendor', fm('vendor', { category: 'Telco', status: 'Active' })),
    note(`${F}/Quotes/Northwind Builders quote.md`, 'quote', fm('quote', { vendor: '"[[Northwind Builders]]"', project: '"[[Harbour Fit-out]]"', amount: 5800, received: '2026-10-10', valid_until: '2026-10-30', status: 'Received', reference: 'Q-118' }) + QUOTE_ITEMS),
    note(`${F}/Quotes/Coastal Sound quote.md`, 'quote', fm('quote', { vendor: '"[[Coastal Sound]]"', project: '"[[Harbour Fit-out]]"', amount: 6450, valid_until: '2026-12-01', status: 'Received' }) + '## Items\n\n| Item | Qty | Unit price | Total |\n| --- | --- | --- | --- |\n| Ceiling speaker (white) | 8 | 500 | 4000 |\n| Labour to install | 1 | 2450 | 2450 |\n'),
    note(`${F}/Quotes/Bluegum fibre quote.md`, 'quote', fm('quote', { vendor: '"[[Bluegum Telco]]"', amount: 1200, valid_until: '2026-10-19', status: 'Received' })),
    note(`${F}/Quotes/Old signage quote.md`, 'quote', fm('quote', { vendor: '"[[Northwind Builders]]"', amount: 300, valid_until: '2026-09-01', status: 'Declined' })),
    note(`${F}/Purchase orders/PO 4501.md`, 'purchase-order', fm('purchase-order', { vendor: '"[[Northwind Builders]]"', project: '"[[Harbour Fit-out]]"', number: 4501, amount: 900, raised: '2026-10-01', delivery: '2026-10-20', status: 'Raised' })),
    note(`${F}/Contracts/Bluegum Telco contract.md`, 'contract', fm('contract', { vendor: '"[[Bluegum Telco]]"', amount: 1800, period: 'Yearly', starts: '2025-11-15', ends: '2026-11-15', notice_days: 30, renewal: 'Auto-renews', status: 'Active' })),
    note(`${F}/Contracts/Cleaning contract.md`, 'contract', fm('contract', { vendor: '"[[Shine Cleaning]]"', amount: 400, period: 'Monthly', starts: '2025-01-01', ends: '2026-09-30', notice_days: 14, renewal: 'Auto-renews', status: 'Active' })),
    note(`${F}/Contracts/Fitout works.md`, 'contract', fm('contract', { vendor: '"[[Northwind Builders]]"', amount: 20000, period: 'One-off', starts: '2026-08-01', ends: '2026-11-05', renewal: 'Ends', status: 'Active' })),
  ];
}

test('validity, notice and end: lapsed, lapsing, decided, auto-renewal rolling on, an order past delivery', () => {
  const V = S.workVendors;
  const m = V.vendorsModel(fixtures(), TODAY, 30, { projects: [{ path: 'Work/Projects/Harbour Fit-out/Harbour Fit-out.md', name: 'Harbour Fit-out' }] });
  const q = (n) => m.quotes.find((x) => x.name === n);
  assert.equal(q('Northwind Builders quote').state, 'Lapses soon');
  assert.equal(q('Northwind Builders quote').days, 6);
  assert.equal(q('Northwind Builders quote').itemsTotal, 5800);
  assert.equal(q('Northwind Builders quote').projectPath, 'Work/Projects/Harbour Fit-out/Harbour Fit-out.md');
  assert.equal(q('Coastal Sound quote').state, 'Valid');
  assert.equal(q('Bluegum fibre quote').state, 'Lapsed', 'a received quote past its day reads lapsed');
  assert.equal(q('Old signage quote').state, 'Declined', 'a decided quote stays as decided');
  const c = (n) => m.contracts.find((x) => x.name === n);
  assert.equal(c('Bluegum Telco contract').noticeBy, '2026-10-16');
  assert.equal(c('Bluegum Telco contract').state, 'In notice period');
  assert.equal(c('Cleaning contract').rolled, true);
  assert.equal(c('Cleaning contract').ends, '2026-10-30', 'monthly auto-renewal rolled on to the next end');
  assert.equal(c('Cleaning contract').noticeBy, '2026-10-16');
  assert.equal(c('Fitout works').state, 'Ending');
  assert.equal(m.orders[0].late, true);
  // Vendors: one named only on a quote or contract still shows, with what is open with each.
  const nw = m.vendors.find((v) => v.name === 'Northwind Builders');
  assert.equal(nw.openQuotes, 1);
  assert.equal(nw.openValue, 5800);
  assert.ok(m.vendors.some((v) => v.name === 'Coastal Sound' && v.path === ''));
  // Attention: worst first; each with its one action and a stable key.
  const words = m.attention.map((a) => a.words);
  assert.ok(words.includes('Bluegum Telco’s quote lapsed on Mon 19 Oct'));
  assert.ok(words.includes('Northwind Builders’ quote lapses in 6 days'));
  // Packs uplift item 15: one plain renews line, with the notice day kept as the receipt underneath.
  assert.ok(words.includes('Bluegum Telco’s contract renews on Sun 15 Nov; too late to give notice'));
  assert.equal(m.attention.find((a) => a.kind === 'contract')?.sub, 'notice was due Fri 16 Oct');
  assert.ok(words.some((w) => /^PO 4501 from Northwind Builders was due Tue 20 Oct/.test(w)));
  assert.equal(m.attention.find((a) => a.kind === 'quote' && a.tone === 'bad').action, 'extend');
  assert.ok(m.attention.every((a) => a.key));
});

test('a quote read from words: the price now (not the crossed-out one), a ref-shaped reference', () => {
  const V = S.workVendors;
  assert.equal(V.readQuoteFromText('Was $2,000, now $1,500').amount, 1500);
  assert.equal(V.readQuoteFromText('Total $5,800').amount, 5800);
  assert.equal(V.readQuoteFromText('Quote from Acme for the fit-out. Total $5,800.').reference, '', '"from" is no reference');
  assert.equal(V.readQuoteFromText('Quote Q-118, total $5,800').reference, 'Q-118');
  assert.equal(V.readQuoteFromText('Reference: HARBOUR-9. Total $400.').reference, 'HARBOUR-9');
});

test('quotes in more than one currency are never mushed to one figure', () => {
  const V = S.workVendors;
  const notes = [...fixtures(), note(`${F}/Quotes/Northwind US licence quote.md`, 'quote', fm('quote', { vendor: '"[[Northwind Builders]]"', amount: 500, currency: 'USD', valid_until: '2026-12-01', status: 'Received' }))];
  const m = V.vendorsModel(notes, TODAY, 30, { currency: 'AUD' });
  const nw = m.vendors.find((v) => v.name === 'Northwind Builders');
  assert.equal(nw.openValueWords, 'AUD 5,800 + USD 500.00', 'each currency in the module’s own money words, never one mushed figure');
  const uniform = V.vendorsModel(fixtures(), TODAY, 30, { currency: 'AUD' });
  assert.equal(uniform.vendors.find((v) => v.name === 'Northwind Builders').openValueWords, '$5,800');
});

test('a quote’s project must resolve: a typo is refused with the projects there', () => {
  const V = S.workVendors;
  const projects = [{ name: 'Harbour Fit-out', path: 'Projects/Harbour Fit-out.md' }, { name: 'Garden', path: 'Projects/Garden.md' }];
  assert.equal(V.resolveVendorProject(projects, 'Harbour Fit-out'), 'Harbour Fit-out');
  assert.equal(V.resolveVendorProject(projects, 'harbour'), 'Harbour Fit-out');
  assert.equal(V.resolveVendorProject(projects, ''), '');
  assert.throws(() => V.resolveVendorProject(projects, 'Harbor Fitout'), /There is no project called.*Projects: Harbour Fit-out, Garden/);
});

test('quotes compared: lowest first, how much more, items lined up by their words', () => {
  const V = S.workVendors;
  const m = V.vendorsModel(fixtures(), TODAY, 30);
  const c = V.compareQuotes(m.quotes.filter((q) => q.project === 'Harbour Fit-out'));
  assert.deepEqual(c.quotes.map((q) => q.vendor), ['Northwind Builders', 'Coastal Sound']);
  assert.equal(c.cheapest, `${F}/Quotes/Northwind Builders quote.md`);
  assert.equal(c.over[`${F}/Quotes/Coastal Sound quote.md`], 650);
  assert.equal(c.rows.length, 2, 'speakers with speakers, labour with labour');
  assert.ok(c.rows.every((r) => r.cells.every(Boolean)));
});

test('records for the views, and their sections', () => {
  const V = S.workVendors;
  const m = V.vendorsModel(fixtures(), TODAY, 30);
  const recs = V.vendorRecords(m);
  const q = recs.find((r) => r.kind === 'quote' && r.title === 'Northwind Builders quote');
  assert.equal(q.projectName, 'Harbour Fit-out');
  assert.equal(q.fields.amount, 5800);
  assert.equal(q.fields.status, 'Lapses soon');
  assert.equal(recs.find((r) => r.kind === 'order').fields.status, 'Late');
  assert.equal(recs.find((r) => r.kind === 'contract' && r.title === 'Bluegum Telco contract').fields.notice_by, '2026-10-16');
  for (const s of ['vendors', 'quotes', 'orders', 'contracts']) assert.ok(V.vendorSectionViews(s).length >= 1, s);
  const fields = S.recordViews.fieldsOf(recs);
  assert.equal(fields.find((f) => f.key === 'amount').type, 'money');
  assert.equal(fields.find((f) => f.key === 'valid_until').type, 'date');
});

test('one change is one line: a property, a link, a day, notice from a day, an item’s cell and its total', () => {
  const V = S.workVendors;
  const text = fixtures()[2].content;
  const a = V.editVendorRecord(text, 'quote', 'amount', '6,100.50', T).text;
  assert.equal(a.split('\n').filter((l, i) => l !== text.split('\n')[i]).length, 1);
  assert.match(a, /^amount: 6100\.5$/m);
  assert.match(V.editVendorRecord(text, 'quote', 'valid_until', '14/11/2026', T).text, /^valid_until: 2026-11-14$/m);
  assert.match(V.editVendorRecord(text, 'quote', 'vendor', 'Coastal Sound', T).text, /^vendor: "\[\[Coastal Sound\]\]"$/m);
  assert.throws(() => V.editVendorRecord(text, 'quote', 'amount', 'lots', T), /Give an amount/);
  assert.throws(() => V.editVendorRecord(text, 'quote', 'nonsense', 'x', T), /can’t be changed/);
  // A lapsed quote put back to Received says why it still reads lapsed.
  const lapsed = fixtures()[4].content;
  assert.match(V.editVendorRecord(lapsed, 'quote', 'status', 'Valid', T).words, /still reads as lapsed/);
  const contract = fixtures()[7].content;
  const n = V.editVendorRecord(contract, 'contract', 'notice_by', '2026-10-26', T);
  assert.match(n.text, /^notice_days: 20$/m);
  // Items: a qty changed works its total out; added and taken off; the rest of the note kept.
  const qty = V.setQuoteItem(text, 0, 'qty', '10');
  assert.match(qty, /\| Ceiling speakers \| 10 \| 450 \| 4500 \|/);
  assert.match(qty, /Call before ordering\./);
  const added = V.addQuoteItem(text, { item: 'Rack', qty: 1, unit: '640' });
  assert.match(added, /\| Rack \| 1 \| 640 \| 640 \|\n\n## Notes/);
  assert.doesNotMatch(V.removeQuoteItem(text, 1), /Install labour/);
  assert.equal(V.amountAfterItems(text, qty), 6700, 'the amount was its items’ total, so it follows them');
  assert.equal(V.amountAfterItems(V.editVendorRecord(text, 'quote', 'amount', 9999, T).text, qty), null, 'an amount of its own stays');
  // A quote without an Items section gets one.
  assert.match(V.addQuoteItem(lapsed, { item: 'Fibre run', total: 1200 }), /## Items\n\n\| Item \| Qty \| Unit price \| Total \|\n\| --- \| --- \| --- \| --- \|\n\| Fibre run \|/);
});

test('new notes, levels and the tools’ answers and plans', () => {
  const V = S.workVendors;
  const L = S.sensitivity;
  for (const t of ['vendor', 'quote', 'purchase-order', 'contract']) assert.equal(L.levelOf(L.emptyStore(), 'x.md', undefined, t).level, 'work', `${t} is Work-confidential`);
  const qt = V.newQuoteText({ vendor: 'Northwind Builders', project: 'Harbour Fit-out', amount: 1200, validUntil: '2026-11-30', items: [{ item: 'Projector', qty: 1, unit: 1200 }] }, T);
  assert.match(qt, /^vendor: "\[\[Northwind Builders\]\]"$/m);
  assert.match(qt, /^received: 2026-10-24$/m);
  assert.match(qt, /\| Projector \| 1 \| 1200 \| 1200 \|/);
  assert.equal(V.quoteName({ vendor: 'Northwind Builders', project: 'Harbour Fit-out' }), 'Northwind Builders quote (Harbour Fit-out)');
  const m = V.vendorsModel(fixtures(), TODAY, 30);
  const input = { model: m, currency: 'AUD', refused: 0 };
  assert.match(V.answerVendorTool(input, 'quote_list', { project: 'harbour' }), /2 quotes:[\s\S]*Northwind Builders quote: Northwind Builders, for Harbour Fit-out; \$5,800; lapses soon/);
  assert.match(V.answerVendorTool(input, 'quote_compare', { project: 'Harbour Fit-out' }), /Coastal Sound: \$6,450 \(\$650.00 more\)/);
  assert.match(V.answerVendorTool(input, 'contract_expiring', {}), /Bluegum Telco contract[\s\S]*give notice by Fri 16 Oct/);
  assert.match(V.answerVendorTool(input, 'vendor_list', { category: 'AV' }), /Northwind Builders \(AV, preferred\)/);
  assert.match(V.answerVendorTool({ model: V.vendorsModel([], TODAY), currency: 'AUD', refused: 3, agent: 'Chat bot' }, 'quote_list', {}), /3 vendor records are marked Work-confidential .* Chat bot isn’t allowed/);
  const folders = { vendor: `${F}/Vendors`, quote: `${F}/Quotes`, contract: `${F}/Contracts` };
  const plan = V.planVendorWrite('quote_add', { vendor: 'Seabreeze Signs', amount: 480, valid_until: '2026-11-20' }, { folders, vendors: ['Northwind Builders'], today: T, currency: 'AUD' });
  assert.equal(plan.vendor.name, 'Seabreeze Signs', 'a new vendor is made too');
  assert.match(plan.text, /^amount: 480$/m);
  assert.doesNotMatch(V.planVendorWrite('quote_add', { vendor: 'northwind av' }, { folders, vendors: ['Northwind Builders'], today: T, currency: 'AUD' }).text, /^amount: \d/m, 'no amount given, none written');
  assert.throws(() => V.planVendorWrite('contract_add', { vendor: 'X', ends: 'soon' }, { folders, vendors: [], today: T, currency: 'AUD' }), /YYYY-MM-DD/);
  assert.throws(() => V.planVendorWrite('quote_add', {}, { folders, vendors: [], today: T, currency: 'AUD' }), /vendor/);
  const proj = V.projectVendors(m, { path: 'Work/Projects/Harbour Fit-out/Harbour Fit-out.md', name: 'Harbour Fit-out' }, 'AUD');
  assert.equal(proj.tile.rows.length, 3, "two quotes and an order");
  assert.ok(proj.attention.some((a) => /lapses in 6 days/.test(a.words)));
});

function vault(files) {
  const dir = mkdtempSync(path.join(work, 'vault-'));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), text);
  }
  const index = new M.VaultIndex();
  for (const [rel, text] of Object.entries(files)) if (rel.endsWith('.md')) index.set(rel, text, 0, text.length);
  return { dir, index };
}

test('main side: the window’s calls, notices said once, a gate that refuses Work-confidential, nothing when off', async () => {
  const L = S.sensitivity;
  const files = { '.neuralvault/areas.json': JSON.stringify({ version: 1, areas: [{ id: 'work', name: 'Work', folder: 'Work' }] }) };
  for (const n of fixtures()) files[n.path] = n.content;
  const { dir, index } = vault(files);
  let switches = { vendors: { on: true } };
  const posted = [];
  const written = new Map();
  const wm = new M.WorkModules({
    vault: () => ({ root: dir, any: async (rel) => written.has(rel) || !!files[rel] }),
    index,
    prefs: () => ({ templatesFolder: 'Templates', modules: switches }),
    writeNote: async (rel, text) => {
      written.set(rel, text);
      index.set(rel, text, 1, text.length);
    },
    importFiles: async () => [],
    pickFiles: async () => [],
    saveFile: async () => null,
    post: (items) => {
      const fresh = items.filter((i) => !posted.some((p) => p.key === i.key));
      posted.push(...fresh);
      return fresh.length;
    },
    editProject: async () => ({}),
    projects: () => [{ path: 'Work/Projects/Harbour Fit-out/Harbour Fit-out.md', name: 'Harbour Fit-out' }],
    records: () => ({}),
    requireCreate: async () => {},
    now: () => TODAY,
  });
  const part = wm.parts.find((p) => p.id === 'vendors');
  const view = await part.ops.model();
  assert.equal(view.quotes.length, 4);
  assert.equal(view.currency, 'AUD');
  // One value changed where it shows: one line of the note.
  const qrel = `${F}/Quotes/Northwind Builders quote.md`;
  await part.ops['set-field']({ kind: 'quote', path: qrel, field: 'valid_until', value: '2026-11-14' });
  assert.match(written.get(qrel), /^valid_until: 2026-11-14$/m);
  // An item's qty changed: its total and the quote's amount follow (it was their total).
  const said = await part.ops['set-item'](qrel, 0, 'qty', 10);
  assert.match(said, /amount follows its items: \$6,700/);
  assert.match(written.get(qrel), /^amount: 6700$/m);
  // A new quote from a new vendor makes the vendor too; accepting one offers the others, never declines them.
  const added = await part.ops['add-quote']({ vendor: 'Seabreeze Signs', project: 'Harbour Fit-out', amount: 7000, validUntil: '2026-12-10' });
  assert.equal(added.vendor, `${F}/Vendors/Seabreeze Signs.md`);
  const acc = await part.ops['accept-quote'](qrel);
  assert.equal(acc.others.length, 2);
  assert.match(written.get(qrel), /^status: Accepted$/m);
  assert.doesNotMatch(written.get(added.path), /^status: Declined$/m);
  // A PO from a quote carries its vendor, project and amount.
  const po = await part.ops['add-order']({ quotePath: qrel, number: '4520' });
  assert.match(written.get(po), /^vendor: "\[\[Northwind Builders\]\]"$/m);
  assert.match(written.get(po), /^amount: 6700$/m);
  // Notices: said once.
  const first = await wm.check();
  assert.ok(first >= 3);
  assert.equal(await wm.check(), 0, 'said once');
  // Through a gate: an agent not allowed Work-confidential sees none and is told why; its write is never made.
  const store = { ...L.emptyStore(), access: { neuralbot: ['open'] } };
  const sens = { stamp: () => 'x', level: (rel) => L.levelOf(store, rel, index.get(rel)?.props?.sensitivity, index.get(rel)?.props?.type).level, decide: (who, rel, name) => L.decide(store, who, rel, sens.level(rel), name), useGrant: () => false, allows: (who, level) => L.allows(store, who, level), audit: () => {} };
  const bot = await wm.callTool('quote_list', {}, M.makeGate(sens, 'neuralbot', 'Chat bot'));
  assert.match(bot.text, /No quotes yet\.[\s\S]*marked Work-confidential .* Chat bot isn’t allowed/);
  const spark = await wm.callTool('quote_list', { which: 'all' }, M.makeGate(sens, 'neuralspark', 'the host app'));
  assert.match(spark.text, /Coastal Sound quote/);
  const before = written.size;
  const refusedWrite = await wm.callTool('contract_add', { vendor: 'X' }, M.makeGate(sens, 'neuralbot', 'Chat bot'));
  assert.match(refusedWrite.text, /isn’t allowed/);
  assert.equal(written.size, before, 'a refused write writes nothing');
  const made = await wm.callTool('contract_add', { vendor: 'Bluegum Telco', amount: 2400, ends: '2027-11-15', notice_days: 30, renewal: 'Auto-renews' }, M.makeGate(sens, 'neuralspark', 'the host app'));
  assert.match(made.text, /Added the contract Bluegum Telco contract, ending Mon 15 Nov 2027\. \[.*Bluegum Telco contract 2\.md\]/);
  // The project's card for its page.
  const proj = await part.ops.project('Work/Projects/Harbour Fit-out/Harbour Fit-out.md');
  assert.ok(proj.tile.rows.length >= 4);
  // Switched off: no tools, no notices; every note untouched by the switch.
  switches = { vendors: { on: false } };
  assert.deepEqual(wm.toolsOn(), []);
  assert.equal(await wm.check(), 0);
  assert.match((await wm.callTool('quote_list', {}, null)).text, /switched off/);
  assert.equal(readFileSync(path.join(dir, `${F}/Vendors/Northwind Builders.md`), 'utf8'), files[`${F}/Vendors/Northwind Builders.md`]);
});

test('9.5 batch 10: Quote Items read as items; no Item column stays -1 (F112)', () => {
  const V = S.workVendors;
  const qi = note(`${F}/Quotes/Q.md`, 'quote', fm('quote', { vendor: '"[[V]]"', status: 'Received' }) + '## Quote Items\n\n| Item | Qty |\n| --- | --- |\n| Rack | 2 |\n');
  const q = V.readQuote(qi, T, 30);
  assert.equal(q.items.length, 1);
  assert.equal(q.items[0].item, 'Rack');
  const noitem = note(`${F}/Quotes/N.md`, 'quote', fm('quote', { vendor: '"[[V]]"', status: 'Received' }) + '## Items\n\n| Qty | Unit price |\n| --- | --- |\n| 2 | 100 |\n');
  assert.equal(V.readQuote(noitem, T, 30).cols.item, -1);
});

test('9.5 batch 10: a mistyped status reads as written, never as the fallback (F114)', () => {
  const V = S.workVendors;
  assert.equal(V.readQuote(note('Q.md', 'quote', fm('quote', { status: 'Recieved' })), T, 30).status, 'Recieved');
  assert.equal(V.readQuote(note('Q.md', 'quote', fm('quote', {})), T, 30).status, 'Received');
  assert.equal(V.readOrder(note('O.md', 'purchase-order', fm('purchase-order', { status: 'Rasied' })), T).status, 'Rasied');
  assert.equal(V.readContract(note('C.md', 'contract', fm('contract', { period: 'Yearl' })), T, 30).period, 'Yearl');
  const m = V.vendorsModel([note(`${F}/Vendors/V.md`, 'vendor', fm('vendor', { category: 'Hardwrae', status: 'Activ' }))], TODAY, 30);
  assert.equal(m.vendors[0].category, 'Hardwrae');
  assert.equal(m.vendors[0].status, 'Activ');
});

test('9.5 batch 10: a near-miss vendor name asks, a new one is made (F117)', () => {
  const V = S.workVendors;
  assert.equal(V.suggestVendorName(['Northwind Builders', 'Bluegum Telco'], 'Northwnd Builders'), 'Northwind Builders');
  assert.equal(V.suggestVendorName(['Northwind Builders'], 'Shine Cleaning'), null);
  assert.equal(V.suggestVendorName(['Northwind Builders'], 'Northwind Builders'), null);
  const ctx = { folders: { vendor: 'V', quote: 'Q', contract: 'C', order: 'O' }, vendors: ['Northwind Builders'], today: T, currency: 'AUD' };
  assert.throws(() => V.planVendorWrite('quote_add', { vendor: 'Northwnd Builders', amount: 100 }, ctx), /Did you mean "Northwind Builders"/);
  assert.ok(V.planVendorWrite('quote_add', { vendor: 'Shine Cleaning', amount: 100 }, ctx).vendor, 'genuinely new: made with its vendor');
});

test('9.5 batch 10: clearing a quantity clears its stale total (F120)', () => {
  const V = S.workVendors;
  const q = '---\ntype: quote\namount: 200\n---\n## Items\n\n| Item | Qty | Unit price | Total |\n| --- | --- | --- | --- |\n| Rack | 2 | 100 | 200 |\n';
  assert.match(V.setQuoteItem(q, 0, 'qty', ''), /\| Rack \| \| 100 \| \|/);
  assert.match(V.setQuoteItem(q, 0, 'qty', 3), /\| Rack \| 3 \| 100 \| 300 \|/);
  assert.throws(() => V.setQuoteItem('## Items\n\n| Qty |\n| --- |\n| 2 |\n', 0, 'item', 'Rack'), /no Item column/);
});

test('9.5 batch 10: one quote resolves, two ask, none is none (F132)', () => {
  const V = S.workVendors;
  const m = V.vendorsModel(fixtures(), TODAY, 30);
  assert.equal(V.resolveQuote(m.quotes, 'Northwind Builders quote').quote.name, 'Northwind Builders quote');
  assert.equal(V.resolveQuote(m.quotes, 'coastal sound', 'Harbour Fit-out').quote.name, 'Coastal Sound quote');
  const amb = V.resolveQuote(m.quotes, 'quote');
  assert.equal(amb.quote, null);
  assert.ok(amb.candidates.length > 1);
  assert.deepEqual(V.resolveQuote(m.quotes, 'no such quote'), { quote: null, candidates: [] });
});

function vmCore() {
  const files = { '.neuralvault/areas.json': JSON.stringify({ version: 1, areas: [{ id: 'work', name: 'Work', folder: 'Work' }] }) };
  for (const n of fixtures()) files[n.path] = n.content;
  const dir = mkdtempSync(path.join(work, 'vault-'));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), text);
  }
  const index = new M.VaultIndex();
  for (const [rel, text] of Object.entries(files)) if (rel.endsWith('.md')) index.set(rel, text, 0, text.length);
  const written = new Map();
  const wm = new M.WorkModules({
    vault: () => ({ root: dir, any: async (rel) => written.has(rel) || !!files[rel] }),
    index,
    prefs: () => ({ templatesFolder: 'Templates', modules: { vendors: { on: true } } }),
    writeNote: async (rel, text) => {
      written.set(rel, text);
      index.set(rel, text, 1, text.length);
    },
    importFiles: async () => [],
    pickFiles: async () => [],
    saveFile: async () => null,
    post: () => 0,
    editProject: async () => ({}),
    projects: () => [{ path: 'Work/Projects/Harbour Fit-out/Harbour Fit-out.md', name: 'Harbour Fit-out' }],
    records: () => ({}),
    requireCreate: async () => {},
    now: () => TODAY,
  });
  return { wm, part: wm.parts.find((p) => p.id === 'vendors'), written, index };
}

test('9.5 batch 11: vendor docs refuse dupes; a near-miss vendor asks; an ambiguous accept asks (F124, F117, F132)', async () => {
  const { wm, part } = vmCore();
  await assert.rejects(part.ops['add-quote']({ vendor: 'Northwind Builders', reference: 'Q-118', amount: 100 }), /already a quote from Northwind Builders with reference Q-118/);
  await assert.rejects(part.ops['add-order']({ vendor: 'Northwind Builders', number: '4501' }), /already a purchase order numbered 4501/);
  await part.ops['add-contract']({ vendor: 'Bluegum Telco', reference: 'C-9' });
  await assert.rejects(part.ops['add-contract']({ vendor: 'Bluegum Telco', reference: 'C-9' }), /already a contract with Bluegum Telco/);
  await part.ops['add-quote']({ vendor: 'Northwind Builders', amount: 50 });
  await part.ops['add-quote']({ vendor: 'Northwind Builders', amount: 60 }, 'no reference: no dup to refuse');
  await assert.rejects(part.ops['add-quote']({ vendor: 'Northwnd Builders', amount: 100 }), /Did you mean "Northwind Builders"/);
  const amb = await wm.callTool('quote_accept', { quote: 'quote' }, null);
  assert.match(amb.text, /More than one quote matches/);
  assert.match(amb.text, /Northwind Builders quote/);
  const one = await wm.callTool('quote_accept', { quote: 'Coastal Sound' }, null);
  assert.match(one.text, /Accepted Coastal Sound’s quote/);
});
