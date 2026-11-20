// node --test tests/module-parity.test.mjs — 8.2 parity pack (29 Oct 2026): every everyday window action has a module
// tool (Finance mark-paid, Lists create-list, Vehicles add-vehicle, Sites add-site/mark-live, Vendors vendor/PO
// add + accept/extend, Meetings series/action tick, Business customer/campaign add + support close, Systems
// machine/service add + Check now, Weekly send), the honesty helpers (a real website check's words, Publications'
// missed-edition day), the Family→Memories album migration text, and Documents and ID in the catalogue. No delete
// tool is ever added: deleting stays the person's action (the Bin). Made-up names and amounts only.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-parity-'));
let S;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'shared.ts');
  const mods = ['module-tools', 'life-tools', 'life-modules', 'lists', 'vehicles', 'work-vendors', 'work-sites', 'business', 'systems', 'work-meetings', 'weekly-updates', 'record-module-tools', 'memories', 'publications', 'finance', 'goals'];
  writeFileSync(entry, mods.map((m) => `export * as ${m.replace(/-(\w)/g, (_, c) => c.toUpperCase())} from ${JSON.stringify(path.join(root, 'src/shared', `${m}.ts`))};`).join('\n'));
  await build({ input: entry, platform: 'node', external: ['yaml'], output: { file: path.join(work, 's.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try { symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction'); } catch {}
  S = await import(pathToFileURL(path.join(work, 's.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const NEW_TOOLS = ['finance_bill_mark_paid', 'list_create', 'vehicle_add', 'site_add', 'site_patch_mark_live', 'vendor_add', 'purchase_order_add', 'quote_accept', 'quote_extend', 'meeting_series_add', 'meeting_action_tick', 'business_customer_add', 'business_campaign_add', 'business_support_close', 'business_site_check', 'system_machine_add', 'system_service_add', 'system_check_now', 'weekly_update_send'];

test('every parity action is a module tool with plain step words, and no tool deletes', () => {
  const names = S.moduleTools.MODULE_TOOLS.map((t) => t.name);
  for (const n of NEW_TOOLS) assert.ok(names.includes(n), `${n} is offered`);
  for (const t of S.moduleTools.MODULE_TOOLS) assert.ok(!/_delete|_remove|_trash/.test(t.name), `${t.name} does not delete`);
  for (const n of NEW_TOOLS) {
    const t = S.moduleTools.MODULE_TOOLS.find((x) => x.name === n);
    assert.ok(t.step.length >= 8 && !t.step.includes('_'), `${n} has plain step words`);
    assert.equal(t.level, 'edit', `${n} is a change (asks first through the gate)`);
    assert.ok(S.lifeModules.moduleInfo(t.module), `${n}'s module is in the catalogue`);
  }
});

test('list_create plans a new list note of its kind', () => {
  const model = S.lists.listsModel([], new Date(2026, 9, 24));
  const plan = S.lists.planListCreate({ name: 'Weekend films', kind: 'Watching' }, { on: true, model });
  assert.equal(plan.name, 'Weekend films');
  assert.match(plan.text, /type: list/);
  assert.match(plan.text, /## Items/);
  assert.match(plan.words, /Weekend films/);
  assert.throws(() => S.lists.planListCreate({ kind: 'Watching' }, { on: true, model }), /name/);
  assert.throws(() => S.lists.planListCreate({ name: 'X' }, { on: false, model }), /off/);
});

test('vehicle_add plans a new vehicle note and never invents one from nothing', () => {
  const model = S.vehicles.vehiclesModel([], new Date(2026, 9, 24));
  const plan = S.vehicles.planVehicleAdd({ make: 'Subaru', model: 'Outback', rego: 'ABC123' }, { on: true, model });
  assert.match(plan.text, /type: vehicle/);
  assert.match(plan.text, /ABC123/);
  assert.throws(() => S.vehicles.planVehicleAdd({}, { on: true, model }), /name|make/);
  const one = S.vehicles.vehiclesModel([{ path: 'Me/Vehicles/Wagon.md', title: 'Family wagon', props: { type: 'vehicle', rego: 'ABC123' }, content: '', type: 'vehicle' }], new Date(2026, 9, 24));
  assert.throws(() => S.vehicles.planVehicleAdd({ name: 'Wagon', rego: 'abc 123' }, { on: true, model: one }), /Family wagon/, 'the same plates are the same car, whatever it is called');
});

test('vendor_add and purchase_order_add plan notes; a new vendor is made once', () => {
  const ctx = { folders: { vendor: 'Work/Vendors/Vendors', quote: 'Work/Vendors/Quotes', contract: 'Work/Vendors/Contracts', order: 'Work/Vendors/Orders' }, vendors: [], today: '2026-10-24', currency: 'AUD' };
  const v = S.workVendors.planVendorWrite('vendor_add', { vendor: 'Northwind Builders', category: 'AV' }, ctx);
  assert.match(v.text, /type: vendor/);
  assert.equal(v.vendor, undefined, 'the vendor note is the plan itself');
  const po = S.workVendors.planVendorWrite('purchase_order_add', { vendor: 'Northwind Builders', amount: 1200, number: '4501' }, ctx);
  assert.match(po.text, /type: purchase-order/);
  assert.ok(po.vendor, 'a new vendor note comes with a first order');
  const po2 = S.workVendors.planVendorWrite('purchase_order_add', { vendor: 'Northwind Builders', amount: 10 }, { ...ctx, vendors: ['Northwind Builders'] });
  assert.equal(po2.vendor, undefined, 'a known vendor is not made again');
});

test('site_add and patch mark-live plans', () => {
  const notes = [{ path: 'Work/Sites/Harbour.md', title: 'Harbour Central', props: { type: 'site', kind: 'Office', status: 'Active' }, content: '---\ntype: site\n---\n## Rooms\n\n| Room | Floor | Purpose | Notes |\n| --- | --- | --- | --- |\n\n## Patch points\n\n| Point | Room | Switch | Port | VLAN | Device | Status | Date | Notes |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n| A-01 | Comms | SW1 | 1 | 10 | Till | To patch | 2026-10-20 | |\n', type: 'site' }];
  const model = S.workSites.sitesModel(notes, new Date(2026, 9, 24));
  const add = S.workSites.planSiteAdd({ name: 'Depot', kind: 'Warehouse' }, { on: true, model });
  assert.match(add.text, /type: site/);
  const live = S.workSites.planPatchLive({ site: 'Harbour Central', point: 'A-01' }, { model });
  assert.equal(live.path, 'Work/Sites/Harbour.md');
  assert.equal(live.row, 0);
  assert.throws(() => S.workSites.planPatchLive({ site: 'Harbour Central', point: 'Z-99' }, { model }), /no patch point/);
  const coded = S.workSites.sitesModel([{ path: 'Work/Sites/Harbour.md', title: 'Harbour Central', props: { type: 'site', code: 'AKL-01' }, content: '', type: 'site' }], new Date(2026, 9, 24));
  assert.throws(() => S.workSites.planSiteAdd({ name: 'Depot', code: 'akl-01' }, { on: true, model: coded }), /Harbour Central/, 'the same code is the same site, whatever it is called');
});

test('finance_bill_mark_paid finds the bill and its day', () => {
  const notes = [{ path: 'Me/Finance/Bills/Harbour Internet.md', title: 'Harbour Internet', props: { type: 'bill', amount: 89, cycle: 'Monthly', due: '2026-11-03', category: 'Phone and internet', status: 'Active' }, content: '', type: 'bill' }];
  const input = { finance: notes, documents: [], on: ['finance'], today: new Date(2026, 9, 24) };
  const plan = S.recordModuleTools.planMarkPaid({ bill: 'Harbour Internet' }, input);
  assert.equal(plan.path, notes[0].path);
  assert.equal(plan.day, '2026-10-24');
  assert.throws(() => S.recordModuleTools.planMarkPaid({ bill: 'Nope' }, input), /no bill/);
});

test('the website check words come from the answer, not a guess', () => {
  assert.equal(S.business.websiteStatusFor(200, 120).status, 'Up');
  assert.equal(S.business.websiteStatusFor(503, 900).status, 'Down');
  assert.equal(S.business.websiteStatusFor(200, 9000).status, 'Slow');
  assert.equal(S.business.websiteStatusFor(null, null).status, 'Down');
});

test('8.3 wave 1: the weekly business answer, prep sheet, follow-up draft and smaller step are tools with plain steps', () => {
  const names = S.moduleTools.MODULE_TOOLS.map((t) => t.name);
  for (const n of ['business_week', 'meeting_prep_sheet', 'meeting_follow_up']) {
    assert.ok(names.includes(n), `${n} is offered`);
    const t = S.moduleTools.MODULE_TOOLS.find((x) => x.name === n);
    assert.ok(t.step.length >= 8 && !t.step.includes('_') && !/—/.test(t.step), `${n} has plain step words`);
  }
  assert.equal(S.moduleTools.MODULE_TOOLS.find((x) => x.name === 'business_week').level, 'read');
  assert.equal(S.moduleTools.MODULE_TOOLS.find((x) => x.name === 'meeting_follow_up').level, 'read', 'a draft never sends');
  assert.equal(S.moduleTools.MODULE_TOOLS.find((x) => x.name === 'meeting_prep_sheet').level, 'edit');
});

test('8.3 wave 1 business: page words fingerprint and this week in plain words', () => {
  assert.equal(S.business.pageHashFor('<p>Hello <b>there</b></p>'), S.business.pageHashFor('<div class="x">hello   there</div>'), 'a restyle is not a wording change');
  assert.notEqual(S.business.pageHashFor('<p>Hello there</p>'), S.business.pageHashFor('<p>Hello again</p>'));
  assert.equal(S.business.websiteCheckDue({ checked: null }, '2026-10-24'), true);
  assert.equal(S.business.websiteCheckDue({ checked: '2026-10-23' }, '2026-10-24'), true);
  assert.equal(S.business.websiteCheckDue({ checked: '2026-10-24' }, '2026-10-24'), false);
  const notes = [
    { path: 'Business/Releases/A 2.4.md', title: 'A 2.4', props: { type: 'release', product: 'A', version: '2.4', date: '2026-10-21', status: 'Released' }, content: '## What changed\n\n- Fix\n', type: 'release' },
    { path: 'Business/Customers/Harbour Cafe.md', title: 'Harbour Cafe', props: { type: 'customer', status: 'Active', value: 49, period: 'Monthly' }, content: '', type: 'customer' },
    { path: 'Business/Support/Sign-in.md', title: 'Sign-in loop', props: { type: 'support-item', customer: '[[Harbour Cafe]]', received: '2026-10-20', status: 'New', priority: 'Urgent' }, content: '', type: 'support-item' },
    { path: 'Business/Websites/Main.md', title: 'Main site', props: { type: 'website', url: 'https://example.com', status: 'Down', checked: '2026-10-24' }, content: '', type: 'website' },
  ];
  const m = S.business.businessModel(notes, new Date(2026, 9, 24));
  const words = S.business.businessWeekWords(m);
  assert.match(words, /Shipped: A 2\.4/);
  assert.match(words, /oldest is Sign-in loop/);
  assert.match(words, /down: Main site/);
  assert.match(S.business.answerBusinessTool({ model: m, on: true }, 'business_week', {}), /This week in Business/);
});

test('8.3 wave 1 meetings: a prep sheet names people and open items; a follow-up draft is never sent', () => {
  const pack = { meeting: { path: 'M.md', title: 'Fit-out sync', date: '2026-10-27', time: '10:00 AM' }, people: [{ name: 'Priya Shah', theirs: [{ what: 'Book the electrician', who: 'Priya Shah', path: 'M.md', from: 'Fit-out sync' }], lastMet: null }], last: { path: 'P.md', title: 'Last sync', date: '2026-10-20', open: [{ what: 'Chase the landlord', who: 'Lee Wong', path: 'P.md', from: 'Last sync' }], notReached: ['Budget'] }, project: { name: 'Harbour Fit-out', path: 'H.md', items: [{ what: 'Landlord slow to reply', path: 'H.md', from: 'Harbour Fit-out' }] }, earlier: [], linked: [], recent: [], count: 3 };
  const sheet = S.workMeetings.prepSheetWords(pack);
  assert.match(sheet, /### Who is coming[\s\S]*Priya Shah/);
  assert.match(sheet, /Chase the landlord/);
  assert.match(sheet, /Where Harbour Fit-out stands/);
  const m = S.workMeetings.readMeeting({ path: 'M.md', title: 'Fit-out sync', props: { type: 'meeting', date: '2026-10-27' }, content: '## Decisions\n\n- Go with two racks\n\n## Actions\n\n- [ ] Send the plan — Sam Okafor · by 30 Oct 2026\n' });
  const draft = S.workMeetings.followUpDraft(m);
  assert.match(draft.subject, /follow-up/);
  assert.match(draft.text, /Go with two racks/);
  assert.match(draft.text, /Send the plan/);
  assert.ok(!/sent/i.test(draft.text.split('\n')[0]), 'the draft does not claim to be sent');
  const mine = S.workMeetings.followUpDraft(m, (a) => a.done, { greeting: 'Hello Sam,', signoff: 'Thanks' });
  assert.match(mine.text, /Hello Sam,/);
  assert.match(mine.text, /Thanks/);
  assert.ok(!/Kia ora/.test(mine.text), 'the greeting varies (9.2)');
});

test('8.3 wave 1 goals: a smaller next step only when behind pace', () => {
  const base = { path: 'G.md', name: 'Save', category: '', status: 'On track', started: '2026-10-01', by: '2026-12-31', daysLeft: 60, unit: '$', startValue: 0, targetValue: 5000, current: 100, progress: 0.02, progressFrom: 'value', milestones: [], habits: [], why: '', closed: false };
  assert.equal(S.goals.smallerNextStep({ ...base, pace: 'On pace', next: null }), '');
  assert.match(S.goals.smallerNextStep({ ...base, pace: 'Behind', next: null }), /smaller step/i);
  assert.match(S.goals.smallerNextStep({ ...base, pace: 'Behind', next: { row: 0, title: 'Draft chapter three', due: null, doneOn: null, done: false, days: null, goal: 'G.md', goalName: 'Save' } }), /Draft chapter three/);
  assert.equal(S.goals.smallerNextStep({ ...base, pace: 'Behind', next: null, targetValue: 100, current: 20, unit: 'km', name: 'Run' }), 'A smaller step for this week: move Run a little toward 100 km; even one small step counts.', 'the unit once (9.2)');
});

test('a missed Publications day is the latest one only', () => {
  const s = { days: [1, 5], time: '07:00' };
  assert.equal(S.publications.lastScheduledDay(s, new Date(2026, 9, 29, 12, 0)), '2026-10-26');
  assert.equal(S.publications.lastScheduledDay(s, new Date(2026, 9, 30, 8, 0)), '2026-10-30');
  assert.equal(S.publications.lastScheduledDay(null, new Date(2026, 9, 30)), null);
});

test('a Family album becomes a Memories album, keeping every photo name', () => {
  const text = S.memories.newFamilyAlbumText('Beach weekend', ['IMG_0412.jpg', 'IMG_0413.jpg']);
  assert.match(text, /type: album/);
  assert.match(text, /IMG_0412\.jpg/);
  assert.match(text, /IMG_0413\.jpg/);
});

test('Documents and ID is in the catalogue, its page and Today', () => {
  assert.ok(S.lifeModules.moduleInfo('documents'), 'in LIFE_MODULES');
  const registry = readFileSync(path.join(root, 'src/renderer/src/views/modules/registry.ts'), 'utf8');
  assert.match(registry, /documents: DocumentsPage/);
  assert.match(registry, /documents: DocumentsToday/);
  assert.ok(S.moduleTools.MODULE_TOOLS.some((t) => t.module === 'documents'), 'its tools are offered');
});
