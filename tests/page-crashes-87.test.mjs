// node --test tests/page-crashes-87.test.mjs — 8.7.1 urgent: pages that "couldn't show" (31 Oct 2026: their
// Publications edition "No. 4 – 2026-10-30" opens to the page guard's card "This page couldn't show", "this keeps
// happening"). Their edition note keeps a Delivery table the deliver automation wrote as | Channel | Time | Result |,
// so the reader's positional When gets "Telegram to Jesse" (a channel, not a day) and the edition page's SENT section
// calls shortDate() on it; shortDate() trusted its input and threw (an Invalid Date's weekday is undefined, and
// .slice() on it throws), and the guard caught it. Every render below is a page's render-time readers and words (the
// code that runs inside PageGuard) driven with odd but valid front matter; any throw is a guard card. Made-up people
// and papers only.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-page-crash-'));
let S;
let M;
const TODAY = new Date(2026, 9, 31, 9, 0);
const TODAY_ISO = '2026-10-31';
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'shared.ts');
  writeFileSync(entry, ['frontmatter', 'publications', 'note-page', 'note-rail', 'note-types', 'notes-list', 'tasks', 'tags', 'inline-fields', 'days', 'clock', 'finance', 'id-documents', 'module-records', 'record-modules', 'house', 'vehicles', 'career', 'travel', 'personal-records', 'work-meetings', 'meetings', 'weekly-updates', 'work-sites', 'work-vendors', 'memories', 'business', 'systems', 'goals', 'lists', 'records', 'people', 'views', 'layouts', 'base-file', 'project-file', 'projects-87', 'health', 'family', 'module-purpose'].map((m) => `export * as ${m.replace(/-(\w)/g, (_, c) => c.toUpperCase())} from ${JSON.stringify(path.join(root, 'src/shared', `${m}.ts`))};`).join('\n') + `\nexport * as projectLook from ${JSON.stringify(path.join(root, 'src/renderer/src/lib/projectLook.ts'))};\n`);
  await build({ input: entry, platform: 'node', external: ['yaml'], output: { file: path.join(work, 's.mjs'), format: 'esm' }, logLevel: 'silent' });
  const main = path.join(work, 'main.ts');
  writeFileSync(main, [`export * from ${JSON.stringify(path.join(root, 'src/main/publications.ts'))};`, `export { VaultIndex } from ${JSON.stringify(path.join(root, 'src/main/indexer.ts'))};`].join('\n'));
  await build({ input: main, platform: 'node', external: ['yaml', 'electron'], output: { file: path.join(work, 'm.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try {
    symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction');
  } catch {}
  S = await import(pathToFileURL(path.join(work, 's.mjs')).href);
  M = await import(pathToFileURL(path.join(work, 'm.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

// ── The odd vault: one note per page kind, each with odd but valid front matter ─────────────────────────────────────
// Unquoted dates and times, numbers, booleans, lists where one value is expected, empty values, wiki-links, en dashes.

const PUB = 'Publications/The Bay Post.md';
const ED3 = 'Publications/The Bay Post/Editions/No. 3 – 2026-10-27.md';
const FILES = {
  [PUB]: `---\ntype: publication\nmasthead: The Bay Post\nschedule: Tue, Fri 06:30\ntemplate: Broadsheet\nprinter: Office Laser 200\nprint: No\ntelegram: Yes\ncopies: 2\ngreyscale: No\n---\n# The Bay Post\n\n## Sections\n\n| Section | Pages | Sources | Rules |\n| --- | --- | --- | --- |\n| Front | 1 | Any named source | The lead with its source |\n| News | 2 | Any named source | |\n`,
  [ED3]: `---\ntype: edition\npublication: "[[The Bay Post]]"\nnumber: 3\ndate: 2026-10-27\nstatus: Delivered\ntemplate: "Broadsheet, format 3"\npdf: "[[Assets/Documents/Bay Post No3 2026-10-27.pdf]]"\npages: 8\nlead: "Ferry timetable changes for summer"\n---\n# The Bay Post · No. 3 · Tuesday 27 October 2026\n\n## Status\n\nDelivered. Lead: ferry timetable changes for summer. 8 pages.\n\n## Delivery\n\n| Channel | Time | Result |\n| --- | --- | --- |\n| Telegram to Sam | Tue 27 Oct 2026, 06:30 | Sent |\n\n## Notes\n\n[[Assets/Documents/Bay Post No3 2026-10-27.pdf|Bay Post No3 2026-10-27.pdf]] — No. 3, Tue 27 Oct 2026 (8 pages).\n`,
  'Publications/The Bay Post/Items/Rain.md': `---\ntype: publication-item\nkind: cartoon\npublication: "[[The Bay Post]]"\nsection: News\nheadline: Rain\ndate: 2026-10-27\nlead: true\n---\n# Rain\n\nA single-panel cartoon about the rain.\n`,
  'Meetings/2026-10-30 Kitchen Reno Catch-up.md': `---\ntype: meeting\ndate: 2026-10-30\ntime: 3:00 PM\nattendees:\n  - "[[Sam Lee]]"\n  - Mia Tran\nproject: "[[Harbour Fit-out]]"\nwhere: Kitchen showroom\nduration: 45\n---\n# Kitchen Reno Catch-up\n\n## Actions\n\n- [ ] Sam to confirm the bench quote by Friday\n- [x] Mia booked the showroom\n`,
  'People/Ana – Jones.md': `---\ntype: person\nrole:\n  - Baker\n  - Volunteer\norganisation: "[[Harbour Bakery]]"\nemail: ana@example.com\nphone: 412345678\nbirthday: 1990-04-12\n---\n# Ana – Jones\n\nMet at the bakery opening.\n`,
  'People/Harbour Bakery.md': `---\ntype: org\nemail: hello@example.com\n---\n# Harbour Bakery\n`,
  'Projects/Harbour Fit-out/Harbour Fit-out.md': `---\ntype: project\nstatus:\n  - active\n  - hold\ndue: 2026-11-05\nprogress: 40\nowner: "[[Sam Lee]]"\nhealth: at risk\n---\n# Harbour Fit-out\n\n## Next steps\n\n- [ ] Chase the landlord @Sam Lee due 2026-11-02\n- [x] Sign-off on the plans\n`,
  'Me/Goals/Run a half marathon.md': `---\ntype: goal\ncategory: Fitness\nby: 2026-12-20\nunit: km\nstart_value: 5\ntarget_value: 21.1\nstatus: On track\nwhy: To finish the bay run in December.\n---\n# Run a half marathon\n\n## Milestones\n\n| Milestone | Day | Done |\n| --- | --- | --- |\n| First 10 km | 2026-11-08 | Yes |\n| First 15 km | 2026-11-29 | No |\n\n## Log\n\n| Day | Value |\n| --- | --- |\n| 2026-10-24 | 8 |\n`,
  'Me/Goals/Read before bed.md': `---\ntype: habit\nschedule: daily\nstreak: 6\n---\n# Read before bed\n\n## Log\n\n| Day | Done |\n| --- | --- |\n| 2026-10-30 | Yes |\n`,
  'Me/Lists/Pantry – restock.md': `---\ntype: list\nkind: Shopping\n---\n# Pantry – restock\n\n## Items\n\n| Item | Needed | Got |\n| --- | --- | --- |\n| Flour | 2 | 0 |\n| Olive oil | 1 | 1 |\n`,
  'Me/Money/Bills/Power – Brightpower.md': `---\ntype: bill\nprovider: Brightpower\namount: 189.5\ncycle: Monthly\nanchor: 2026-09-14\npaid: 2026-10-14\nautopay: true\nstatus: Open\naccount: "[[Everyday]]"\n---\n# Power – Brightpower\n`,
  'Me/Money/Accounts/Everyday.md': `---\ntype: bank-account\nbank: Harbour Mutual\nbalance: 2450.75\n---\n# Everyday\n`,
  'Me/Documents and ID/Passport (Sam).md': `---\ntype: id-document\nkind: Passport\nholder: Sam\nnumber: 412345678\nexpires: 2027-02-01\n---\n# Passport (Sam)\n`,
  'Home/House/Home.md': `---\ntype: house\naddress: 4 Example Lane\nownership: Renting\nmoved_in: 2024-02-01\ncontact: "[[Pat Agent]]"\n---\n# Home\n`,
  'Home/House/Appliances/Dishwasher.md': `---\ntype: appliance\nkind: Dishwasher\nroom: Kitchen\nmake: Brightline\npurchased: 2024-11-20\nprice: 899\nwarranty: 2026-11-20\nstatus: In use\n---\n# Dishwasher\n`,
  'Home/House/Maintenance/Clean the gutters.md': `---\ntype: upkeep\nevery: Half-yearly\nlast_done: 2026-04-10\nroom: Roof\nwho: Sam\nstatus: Active\n---\n# Clean the gutters\n\n## Done\n\n| Date | By | Cost | Notes |\n| --- | --- | --- | --- |\n| 2026-04-10 | Sam | 0 | |\n`,
  'Home/Vehicles/Runabout – 2019.md': `---\ntype: vehicle\nkind: Car\nmake: Roadster\nyear: 2019\nrego: ABC123\nrego_due: 2026-11-05\ninsurance_due: 2027-03-01\nservice_due: 2027-02-01\nservice_km: 60500\nfuel: Petrol\nstatus: Active\n---\n# Runabout – 2019\n\n## Fuel log\n\n| Date | Litres | Cost | Odometer | Full |\n| --- | --- | --- | --- | --- |\n| 2026-10-10 | 44 | 88.00 | 60400 | Yes |\n`,
  'Me/Career/Applications/Analyst at Brightwater.md': `---\ntype: job-application\ncompany: "[[Brightwater]]"\nrole: Analyst\nstage: Interview\napplied: 2026-10-01\nnext_step: Send the work sample\nnext_date: 2026-10-23\n---\n# Analyst at Brightwater\n\n## Interviews\n\n| Date | Time | Kind | With | Where | Outcome | Notes |\n| --- | --- | --- | --- | --- | --- | --- |\n| 2026-10-25 | 10:30 | Video | Panel | Video link | Booked | |\n`,
  'Me/Travel/Trips/Harbour City – Nov 2026.md': `---\ntype: trip\ndestination: Harbour City\npurpose: Work\nstarts: 2026-10-28\nends: 2026-10-30\nstatus: Booked\nbudget: 1200\ntravellers:\n  - "[[Sam]]"\n---\n# Harbour City – Nov 2026\n\n## Itinerary\n\n| Date | Time | Kind | What | Until | Where | Booking | Cost | Paid | Notes |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n| 2026-10-28 | 07:05 | Flight | QF 412 to Harbour City | 08:35 | Terminal 3 | QX7P2 | 289 | Yes | |\n`,
  'Work/Weekly Updates/Weekly update 2026-10-26.md': `---\ntype: weekly-update\nweek: 2026-10-26\n---\n# Weekly update 2026-10-26\n\n## Garden\n\n**Status:** Seeds in\n\nA note to self.\n\n- Watered\n\nRisks: frost\n`,
  'Work/Sites/Harbour Office.md': `---\ntype: site\nkind: Office\nstatus: Live\n---\n# Harbour Office\n\n## Rooms\n\n| Room | Floor | Notes |\n| --- | --- | --- |\n| Server room | 2 | |\n`,
  'Work/Sites/Devices/Core switch.md': `---\ntype: device\nsite: "[[Harbour Office]]"\nkind: Switch\nstatus: Live\nwarranty: 2027-06-01\neol: 2029-06-01\n---\n# Core switch\n`,
  'Work/Vendors/Inkwell.md': `---\ntype: vendor\ncategory: Printing\nstatus: Active\n---\n# Inkwell\n`,
  'Work/Vendors/Quotes/Ink cartridges Q3.md': `---\ntype: quote\nvendor: "[[Inkwell]]"\nstatus: Accepted\ntotal: 440\n---\n# Ink cartridges Q3\n\n## Items\n\n| Item | Qty | Unit | Amount |\n| --- | --- | --- | --- |\n| Black cartridge | 4 | 55 | 220 |\n| Colour cartridge | 4 | 55 | 220 |\n`,
  'Work/Vendors/Orders/Order 1042.md': `---\ntype: purchase-order\nvendor: "[[Inkwell]]"\nstatus: Ordered\ntotal: 440\nordered: 2026-10-20\n---\n# Order 1042\n`,
  'Work/Vendors/Contracts/Cleaning 2026.md': `---\ntype: contract\nvendor: "[[Harbour Cleaners]]"\nstatus: Current\nstarts: 2026-01-01\nends: 2026-12-31\nvalue: 12000\nrenewal: Auto\nnotice_days: 30\n---\n# Cleaning 2026\n`,
  'Me/Memories/Albums/Beach – 2024.md': `---\ntype: album\nkind: Photos\nday: 2024-01-14\npeople:\n  - "[[Sam]]"\n  - "[[Ana – Jones]]"\n---\n# Beach – 2024\n`,
  'Me/Memories/Projects/Library poster.md': `---\ntype: creative-project\nkind: Poster\nstatus: Draft\nbrief: A poster for the library fair.\n---\n# Library poster\n`,
  'Work/Business/Customers/Harbour Bakery.md': `---\ntype: customer\nstatus: Active\nsince: 2025-03-01\ncontact: "[[Ana – Jones]]"\n---\n# Harbour Bakery\n`,
  'Work/Business/Support/Till receipt reprint.md': `---\ntype: support-item\nstatus: Open\npriority: High\ncustomer: "[[Harbour Bakery]]"\nopened: 2026-10-29\n---\n# Till receipt reprint\n`,
  'Work/Business/Websites/harbourbakery.example.md': `---\ntype: website\nurl: https://harbourbakery.example\nstatus: Live\nrenewal: 2027-01-15\n---\n# harbourbakery.example\n`,
  'Work/Systems/Machines/Office server.md': `---\ntype: machine\nkind: Server\nstatus: Live\nos: Debian 12\n---\n# Office server\n`,
  'Work/Systems/Services/Nightly backup.md': `---\ntype: service\nstatus: Live\nmachine: "[[Office server]]"\n---\n# Nightly backup\n`,
  'Work/Systems/Runbooks/Restart the backup.md': `---\ntype: runbook\nevery: Monthly\nlast_run: 2026-10-01\n---\n# Restart the backup\n\n## Steps\n\n1. Open the backup panel\n2. Press Restart\n`,
  'Notes/Flourless cake.md': `---\ntype: note\ntags: baking\nrating: 5\ntried: true\nsource:\n---\n# Flourless cake\n\nBest with cream. Baked on 2026-10-25.\n\nBaker:: Ana – Jones\nRating:: 5\n`,
};

function vaultOf(files) {
  const dir = mkdtempSync(path.join(work, 'vault-'));
  const index = new M.VaultIndex();
  const put = (rel, text) => {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), text);
    if (rel.endsWith('.md')) index.set(rel, text, Date.now(), text.length);
  };
  for (const [rel, text] of Object.entries(files)) put(rel, text);
  return { dir, index, put };
}

function pubService(v) {
  const printer = {
    pdf: async () => ({ pdf: Buffer.from('%PDF-1.4'), laidOut: { pages: 1, sections: [], items: {}, cut: [] } }),
    print: async () => ({ pages: 1, sections: [], items: {}, cut: [] }),
    printers: async () => [],
    stage: async () => 'file:///stage.html',
  };
  return new M.Publications({
    root: () => v.dir,
    index: v.index,
    prefs: () => ({ templatesFolder: 'Templates', modules: { publications: { on: true } } }),
    writeNote: async (rel, text) => v.put(rel, text),
    requireCreate: async () => {},
    exists: async (rel) => existsSync(path.join(v.dir, rel)),
    files: async () => [],
    placeFile: async () => ({ rel: 'x', version: 1 }),
    copyIn: async () => [],
    pickFiles: async () => [],
    pickSave: async () => null,
    printer,
    appFonts: async () => ({}),
    readPdfText: async () => '',
    post: () => 0,
    changed: () => {},
    now: () => TODAY,
  });
}

/** Every indexed note as the pages' readers take it. */
const asNotes = (index) => index.allMeta().map((m) => ({ path: m.path, title: m.title, props: m.props ?? {}, content: index.content(m.path) ?? '', headings: m.headings ?? [], tags: m.tags ?? [], mtime: m.mtime ?? 0, links: m.links ?? [] }));
/** Notes as the main side hands them to a pack's model: the type id on the note (WorkModules.notesOf). */
const modelNotes = (index) => asNotes(index).map((n) => ({ ...n, type: String(n.props.type ?? '').toLowerCase() }));
const modelNote = (index, rel) => ({ ...noteIn(index, rel), type: String(noteIn(index, rel).props.type ?? '').toLowerCase() });
// Odd values by contract: odd strings for (string) helpers, every odd shape for unknown/raw-prop helpers.
const ODD_STR = ['soon', 'Telegram to Sam', 'Tue 27 Oct 2026, 06:30', '2026-13-45', '2026-10-32', '10/11/12', 'breakfast', '', '   '];
const noteIn = (index, rel) => {
  const m = index.get(rel);
  return { path: rel, title: m.title, props: m.props ?? {}, content: index.content(rel) ?? '' };
};

// ── 1. The crash: the edition page's SENT section over a Channel|Time|Result delivery table ────────────────────────

test("the edition page renders with a delivery table written as Channel|Time|Result (a real edition's shape)", async () => {
  const v = vaultOf(FILES);
  const p = pubService(v);
  const st = await p.state();
  assert.ok(st.current, 'a publication is read');
  const e = st.current.editions.find((x) => x.path === ED3);
  assert.ok(e, 'the edition is listed');
  assert.equal(e.date, '2026-10-27', 'its unquoted date reads as the day written');
  assert.equal(e.number, 3);
  assert.equal(e.pages, 8);
  // The edition page's own render: its tag, day line, delivery line and SENT rows (PublicationsPage EditionPage).
  const tag = e.date !== null && e.date < TODAY_ISO && e.status !== 'Delivered' && e.status !== 'Printed' ? 'Late' : e.status;
  assert.equal(tag, 'Delivered');
  const detail = await p.edition(ED3);
  assert.ok(detail.sections.length > 0);
  // Delivery rows are read by their header (Channel|Time|Result), not by position.
  assert.deepEqual(detail.edition.delivery.map((d) => [d.how, d.when, d.result]), [['Telegram to Sam', 'Tue 27 Oct 2026, 06:30', 'Sent']]);
  // The archive search over the odd edition renders its hits.
  const rawEditions = [S.publications.readEdition(noteIn(v.index, ED3))];
  const rawItems = [S.publications.readItem(noteIn(v.index, 'Publications/The Bay Post/Items/Rain.md'))];
  let hits;
  assert.doesNotThrow(() => (hits = S.publications.searchArchive('ferry', { editions: rawEditions, items: rawItems })), 'search the odd archive');
  for (const h of hits) assert.doesNotThrow(() => S.publications.shortDate(h.date), 'hit day');
  // The page itself is wired to the guarded readers (not its own copies).
  const page = readFileSync(path.join(root, 'src/renderer/src/views/modules/PublicationsPage.tsx'), 'utf8');
  assert.ok(page.includes("editionDay, kindInfo, shortDate, timeWords"), 'the edition page reads days through the shared readers');
  assert.ok(!/function editionDay|function timeWords/.test(page), 'no local day readers left beside the shared ones');
  assert.ok(page.includes('shortDate(d.when) || d.when'), 'SENT shows an unreadable day as written');
  const pack = readFileSync(path.join(root, 'src/renderer/src/views/modules/pack87.tsx'), 'utf8');
  assert.ok(pack.includes("from '../../../../shared/pack-dates'"), 'the packs read their day words from the one guarded place');
  // SENT renders each row's day without throwing, showing an unreadable day as written.
  for (const d of detail.edition.delivery) {
    const meta = [d.when ? (S.publications.shortDate(d.when) || d.when) : '', d.result].filter(Boolean).join(' · ');
    assert.match(meta, /Tue 27 Oct 2026, 06:30/, 'the sent time shows as written');
    assert.match(meta, /Sent/);
  }
});

test('shortDate and longDate never throw: an unreadable day gives nothing, for the page to show as written', () => {
  const P = S.publications;
  for (const bad of ['Telegram to Sam', 'Tue 27 Oct 2026, 06:30', 'soon', '2026-13-45', '', 4, true, null, undefined, ['2026-10-27'], { day: 'x' }, new Date('2026-10-27T00:00:00Z')]) {
    assert.equal(P.shortDate(bad), '', `shortDate(${JSON.stringify(String(bad))}) gives nothing`);
    assert.equal(P.longDate(bad), '', `longDate(${JSON.stringify(String(bad))}) gives nothing`);
  }
  assert.equal(P.shortDate('2026-10-27'), 'Tue 27 Oct');
  assert.equal(P.longDate('2026-10-27'), 'Tuesday 27 October 2026');
  assert.equal(P.shortDate('2026-10-27T06:30:00'), 'Tue 27 Oct', 'a date-time still reads its day');
});

// ── 2. The mechanism: front matter normalises where it is read; every text use is guarded ──────────────────────────

test('front matter normalises where it is read: dates to ISO text, numbers and booleans kept', () => {
  const F = S.frontmatter;
  // Dates and date-times become ISO text (a YAML date is midnight UTC: its UTC day is the day written).
  assert.equal(F.normaliseProp(new Date('2026-10-27T00:00:00Z')), '2026-10-27');
  assert.equal(F.normaliseProp(new Date('2026-10-27T06:30:00Z')), '2026-10-27T06:30');
  assert.deepEqual(F.normaliseProp([new Date('2026-10-27T00:00:00Z'), 4]), ['2026-10-27', 4], 'inside lists too');
  assert.deepEqual(F.normaliseProp({ when: new Date('2026-10-27T00:00:00Z') }), { when: '2026-10-27' }, 'and inside maps');
  // Numbers and booleans are kept as they are.
  assert.equal(F.normaliseProp(4), 4);
  assert.equal(F.normaliseProp(89.95), 89.95);
  assert.equal(F.normaliseProp(true), true);
  assert.equal(F.normaliseProp(false), false);
  assert.equal(F.normaliseProp('hello'), 'hello');
  assert.equal(F.normaliseProp(null), null);
  // And readProps applies it to what the YAML reader gives back.
  const props = F.readProps('---\nnumber: 4\npages: 12\nlead: true\nprint: No\ntags: [baking, "weekend cake"]\nempty:\n---\nWords.\n');
  assert.deepEqual(props, { number: 4, pages: 12, lead: true, print: 'No', tags: ['baking', 'weekend cake'], empty: null });
});

test('date and time words never throw on odd values (every pack page shares them)', async () => {
  const odd = [4, 4.5, true, false, null, undefined, '', '   ', 'soon', 'Telegram to Sam', 'Tue 27 Oct 2026, 06:30', '2026-13-45', '2026-10-32', '10/11/12', ['2026-10-27'], { day: 'x' }, new Date('2026-10-27T00:00:00Z')];
  // The edition page's day line and delivery time (PublicationsPage) read through the shared readers.
  for (const v of odd) {
    assert.doesNotThrow(() => S.publications.editionDay(v), `editionDay(${JSON.stringify(String(v))})`);
    assert.equal(typeof S.publications.editionDay(v), 'string');
    assert.doesNotThrow(() => S.publications.timeWords(v), `timeWords(${JSON.stringify(String(v))})`);
    assert.equal(typeof S.publications.timeWords(v), 'string');
  }
  assert.equal(S.publications.editionDay('2026-10-27'), 'Tuesday 27 October');
  assert.equal(S.publications.editionDay(null), '');
  assert.equal(S.publications.timeWords('06:30'), '6:30 am');
  assert.equal(S.publications.timeWords('18:05'), '6:05 pm');
  assert.equal(S.publications.timeWords('breakfast'), 'breakfast', 'an unreadable time shows as written');
  // The packs' shared day words (pack87) read through the one guarded place.
  let D = null;
  try {
    const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
    const e2 = path.join(work, 'dates.ts');
    writeFileSync(e2, `export * from ${JSON.stringify(path.join(root, 'src/shared/pack-dates.ts'))};`);
    await build({ input: e2, platform: 'node', output: { file: path.join(work, 'd.mjs'), format: 'esm' }, logLevel: 'silent' });
    D = await import(pathToFileURL(path.join(work, 'd.mjs')).href);
  } catch {
    D = null;
  }
  assert.ok(D, 'src/shared/pack-dates.ts holds the packs’ day words, guarded');
  for (const v of odd) {
    for (const fn of ['weekdayOf', 'shortDay', 'monthDay', 'monthYear', 'weekdayLong', 'fullShort', 'longDay']) {
      assert.doesNotThrow(() => D[fn](v), `${fn}(${JSON.stringify(String(v))})`);
      assert.equal(typeof D[fn](v), 'string');
    }
    assert.doesNotThrow(() => D.checkedWords(v, TODAY_ISO));
    assert.equal(typeof D.checkedWords(v, TODAY_ISO), 'string');
  }
  assert.equal(D.shortDay('2026-10-27'), '27 Oct');
  assert.equal(D.longDay('2026-10-27'), '27 Oct 2026');
  assert.equal(D.checkedWords(TODAY_ISO, TODAY_ISO), 'Today');
  assert.equal(D.checkedWords(null, TODAY_ISO), 'Never checked');
  // The projects' date words (projectLook) guard what isn't a day.
  for (const v of [...ODD_STR, null, undefined]) {
    assert.doesNotThrow(() => S.projectLook.readDate(v), `readDate(${JSON.stringify(String(v))})`);
    assert.doesNotThrow(() => S.projectLook.dueWords(v, 'active'), `dueWords(${JSON.stringify(String(v))})`);
  }
  assert.equal(S.projectLook.healthTone('Offer extended'), 'none', 'the home reads whole words too');
  assert.equal(S.projectLook.healthTone('Delivered'), 'ok', 'delivered reads as done, in green');
  assert.equal(S.projectLook.readDate('2026-10-27'), new Date(2026, 9, 27).getTime());
  assert.equal(S.projectLook.readDate(''), null);
  assert.equal(S.projectLook.readDate(undefined), null);
});

// ── 3. The walk: every page kind renders with the odd vault ────────────────────────────────────────────────────────
// Each page's render-time readers and words over the odd vault's real indexed notes; any throw is a guard card.

test("notes: a note's top, fields, rail, type and tasks render with odd properties", () => {
  const v = vaultOf(FILES);
  const notes = asNotes(v.index);
  const byPath = new Map(notes.map((n) => [n.path, n]));
  const resolve = (target, from) => v.index.resolve(target, from);
  for (const n of notes) {
    const NP = S.notePage, F = S.frontmatter;
    assert.doesNotThrow(() => NP.readCover(n.props.cover), `${n.path} cover`);
    assert.doesNotThrow(() => NP.readIcon(n.props.icon), `${n.path} icon`);
    assert.doesNotThrow(() => NP.readType(n.props), `${n.path} type`);
    assert.doesNotThrow(() => NP.fieldRows(n.props, [], {}), `${n.path} rows`);
    for (const [k, val] of Object.entries(n.props)) assert.doesNotThrow(() => F.propKind(k, val), `${n.path} kind ${k}`);
    assert.doesNotThrow(() => F.asStrings(n.props.tags), `${n.path} tags`);
    assert.doesNotThrow(() => NP.meetingPeople(n.props), `${n.path} meeting people`);
    assert.doesNotThrow(() => NP.isMeetingNote(n), `${n.path} is meeting`);
    assert.doesNotThrow(() => S.noteRail.noteRail({ path: n.path, text: n.content, notes, backlinkPaths: [], resolve }), `${n.path} rail`);
    assert.doesNotThrow(() => S.noteTypes.typeOfNote({ path: n.path, props: n.props }, [], 'Templates'), `${n.path} note type`);
    assert.doesNotThrow(() => S.notesList.noteKindOf({ path: n.path, title: n.title, typeId: null, props: n.props }), `${n.path} kind`);
    assert.doesNotThrow(() => S.notesList.stripRepeatHeading(n.content, n.title), `${n.path} strip heading`);
    assert.doesNotThrow(() => S.notesList.hidesFirstLine(n.content, n.title), `${n.path} hides first`);
    assert.doesNotThrow(() => S.notesList.snippetFor({ path: n.path, title: n.title, headings: n.headings }, n.content), `${n.path} snippet`);
    assert.doesNotThrow(() => S.tasks.findAllTasks(n.content), `${n.path} tasks`);
    assert.doesNotThrow(() => S.inlineFields.fieldProps(n.content), `${n.path} inline fields`);
    assert.doesNotThrow(() => S.days.calendarDayOf(n.props.date), `${n.path} calendar day`);
  }
  const person = byPath.get('People/Ana – Jones.md');
  assert.deepEqual(S.notePage.meetingPeople(person.props), [], 'a list role is not people');
  const rail = S.noteRail.noteRail({ path: 'Meetings/2026-10-30 Kitchen Reno Catch-up.md', text: byPath.get('Meetings/2026-10-30 Kitchen Reno Catch-up.md').content, notes, backlinkPaths: [], resolve });
  assert.equal(rail.area, 'Meetings');
  const pages = S.notePage.personPages('People/Ana – Jones.md', notes.map((n) => ({ ...n, links: [] })), resolve);
  assert.ok(Array.isArray(pages.meetings) && Array.isArray(pages.projects));
});

test('projects: odd project files and boards render', () => {
  const v = vaultOf(FILES);
  const text = v.index.content('Projects/Harbour Fit-out/Harbour Fit-out.md');
  const PF = S.projectFile;
  let project;
  assert.doesNotThrow(() => (project = PF.parseProject(text, 'Harbour Fit-out.md')), 'parse odd project');
  assert.doesNotThrow(() => PF.openSteps(project), 'open steps');
  assert.doesNotThrow(() => PF.serializeProject(project, text), 'round trip');
  assert.doesNotThrow(() => S.projects87.propStatus({ status: 4, health: true }), 'odd status words');
  for (const bad of ['tomorrow', 'soon', '', '2026-13-45', 4, true, null, undefined]) assert.doesNotThrow(() => S.projects87.taskDueTag(bad, 'morning', TODAY_ISO), `due tag ${String(bad)}`);
  assert.doesNotThrow(() => S.projects87.barPct(4, 6, 0, 10), 'bar math');
});

test('meetings: the Meetings page and a meeting note render with odd dates, times and people', () => {
  const v = vaultOf(FILES);
  const notes = asNotes(v.index);
  const W = S.workMeetings, MT = S.meetings;
  let model;
  assert.doesNotThrow(() => (model = W.meetingsModel(notes, TODAY, { known: ['Sam Lee'] })), 'meetings model');
  assert.ok(model.meetings.length >= 1, 'the odd meeting is read');
  const m = noteIn(v.index, 'Meetings/2026-10-30 Kitchen Reno Catch-up.md');
  let rec;
  assert.doesNotThrow(() => (rec = W.readMeeting(m, ['Sam Lee'])), 'read meeting');
  assert.doesNotThrow(() => W.meetingDayLabel(rec.date, TODAY_ISO), 'day label');
  assert.doesNotThrow(() => W.meetingPhase({ date: rec.date, dated: rec.dated }, TODAY_ISO), 'phase');
  assert.doesNotThrow(() => W.meetingActionCounts(rec), 'action counts');
  assert.doesNotThrow(() => MT.meetingDate(m.path, m.props), 'meeting date');
  assert.doesNotThrow(() => MT.notePeople(m.content, m.props), 'note people');
  assert.doesNotThrow(() => MT.findActions(m.content, { date: TODAY, people: ['Sam Lee'], me: 'Sam' }), 'find actions');
  assert.doesNotThrow(() => MT.asNextStep({ what: 'Confirm the bench', who: 'Sam', whenWords: 'Friday' }, TODAY), 'next step');
  for (const bad of [4, true, null, undefined, '', 'soon', ['2026-10-30'], new Date('2026-10-30T00:00:00Z')]) assert.doesNotThrow(() => MT.meetingDate('Meetings/x.md', { date: bad }), `meetingDate(${String(bad)})`);
  for (const bad of ODD_STR) {
    assert.doesNotThrow(() => W.meetingDayLabel(bad, TODAY_ISO), `meetingDayLabel(${bad})`);
    assert.equal(typeof W.meetingDayLabel(bad, TODAY_ISO), 'string');
  }
});

test('people: People and a person render with odd roles, numbers and links', () => {
  const v = vaultOf(FILES);
  const notes = asNotes(v.index);
  const R = S.records;
  const model = R.buildRecordModel({ notes, resolve: (t, f) => v.index.resolve(t, f), today: TODAY_ISO });
  let cards;
  assert.doesNotThrow(() => (cards = S.people.personCards(model, (p) => v.index.get(p)?.props)), 'people cards');
  assert.ok(cards.length >= 1, 'the odd person is a card');
  for (const c of cards) {
    assert.doesNotThrow(() => S.people.filterPeople([c], 'all', TODAY_ISO, ''), 'filter');
    assert.doesNotThrow(() => S.people.nextMeetingWords(c.nextMeeting?.date ?? '', TODAY_ISO), 'next meeting words');
  }
  for (const bad of [4, true, null, undefined, '', 'soon']) assert.doesNotThrow(() => S.people.nextMeetingWords(bad, TODAY_ISO), `nextMeetingWords(${String(bad)})`);
});

test('records: every note joins the records with odd properties', () => {
  const v = vaultOf(FILES);
  const notes = asNotes(v.index);
  const R = S.records;
  let model;
  assert.doesNotThrow(() => (model = R.buildRecordModel({ notes, resolve: (t, f) => v.index.resolve(t, f), today: TODAY_ISO })), 'record model');
  assert.ok(model.records.size > 0);
  for (const n of notes) assert.doesNotThrow(() => R.propFacts(n.props), `${n.path} facts`);
  for (const id of model.records.keys()) {
    assert.doesNotThrow(() => R.connectedTo(model, id), `${id} connections`);
    assert.doesNotThrow(() => R.peekOf(model, { id }), `${id} peek`);
  }
  assert.doesNotThrow(() => R.findRecords(model, 'harbour'), 'find');
  assert.doesNotThrow(() => R.projectAttention(model, 'x'), 'attention');
});

test('views: a saved view lists, filters and sorts the odd notes', () => {
  const v = vaultOf(FILES);
  const notes = asNotes(v.index);
  const V = S.views;
  const def = V.defaultView({ kind: 'folder', value: 'Me' }, 'table');
  def.columns = ['date', 'status', 'rating'];
  def.sort = { prop: 'date', dir: 'asc' };
  let rows;
  assert.doesNotThrow(() => (rows = V.runView(def, notes)), 'run table over odd notes');
  assert.ok(rows.length > 0);
  def.filters = [{ prop: 'status', op: 'is', value: 'Open' }];
  assert.doesNotThrow(() => V.runView(def, notes), 'filter odd values');
  def.filters = [{ prop: 'rating', op: 'gt', value: '3' }];
  assert.doesNotThrow(() => V.runView(def, notes), 'compare odd numbers');
  for (const r of rows) for (const k of ['date', 'status', 'rating', 'tried']) assert.doesNotThrow(() => V.valueText(V.valueOf(r, k)), `${r.path} ${k} text`);
  assert.doesNotThrow(() => V.summarize(rows, 'rating', 'sum'), 'summarise odd numbers');
  assert.doesNotThrow(() => S.baseFile.readViewFile('Odd.base', 'filters:\n  - status is Open\n'), 'read odd view file');
});


// ── 4. The walk, the packs: each pack's page, inner pages and Today rows with the odd vault ─────────────────────────

test('packs share one guarded day-words pair for their Needs strips', () => {
  const MP = S.modulePurpose;
  for (const bad of [...ODD_STR, null, undefined]) {
    assert.doesNotThrow(() => MP.dayWords(bad, TODAY_ISO), `dayWords(${String(bad)})`);
    assert.equal(typeof MP.dayWords(bad, TODAY_ISO), 'string');
    assert.doesNotThrow(() => MP.whenWords(bad, TODAY_ISO), `whenWords(${String(bad)})`);
    assert.equal(typeof MP.whenWords(bad, TODAY_ISO), 'string');
  }
  assert.equal(MP.dayWords('2026-10-27', TODAY_ISO), '27 Oct');
});

test("goals and lists: Goals, its goal and habit pages, the review and Lists render with odd numbers and days", () => {
  const v = vaultOf(FILES);
  const notes = modelNotes(v.index);
  const G = S.goals, L = S.lists;
  let model;
  assert.doesNotThrow(() => (model = G.goalsModel(notes, TODAY_ISO)), 'goals model');
  assert.ok(model.goals.length >= 1, 'the odd goal is read');
  const goal = modelNote(v.index, 'Me/Goals/Run a half marathon.md');
  const habit = modelNote(v.index, 'Me/Goals/Read before bed.md');
  let g, h;
  assert.doesNotThrow(() => (g = G.readGoal(goal, TODAY_ISO)), 'read goal');
  assert.doesNotThrow(() => (h = G.readHabit(habit, TODAY_ISO, [g])), 'read habit');
  assert.doesNotThrow(() => G.readReview(goal), 'read review shape');
  assert.doesNotThrow(() => G.weekSummary([g], [h], G.weekOf(TODAY_ISO)), 'week summary');
  assert.doesNotThrow(() => G.smallerNextStep(g), 'next step');
  for (const bad of ODD_STR) {
    assert.doesNotThrow(() => G.weekOf(bad), `weekOf(${bad})`);
    assert.doesNotThrow(() => G.streaksOf([bad], 1, TODAY_ISO), `streaksOf(${bad})`);
  }
  let lists;
  assert.doesNotThrow(() => (lists = L.listsModel(notes, TODAY_ISO)), 'lists model');
  assert.doesNotThrow(() => L.readList(modelNote(v.index, 'Me/Lists/Pantry – restock.md')), 'read list');
  for (const bad of ODD_STR) assert.doesNotThrow(() => L.stateOf('Shopping', bad), `stateOf(${bad})`);
  assert.doesNotThrow(() => L.cleanItem('Shopping', { item: 4, needed: true, got: [1], note: null }), 'clean odd item values');
});

test('money and papers: Finance, Documents and their records render with odd amounts and days', () => {
  const v = vaultOf(FILES);
  const notes = modelNotes(v.index);
  const F = S.finance, D = S.idDocuments;
  let model;
  assert.doesNotThrow(() => (model = F.financeModel(notes, TODAY)), 'finance model');
  assert.ok(model.bills.length >= 1, 'the odd bill is read');
  assert.doesNotThrow(() => S.recordModules.financeRecords(model), 'bill records');
  assert.doesNotThrow(() => S.recordModules.billDays(model), 'bill days');
  for (const b of model.bills) assert.doesNotThrow(() => F.dueWords(b.next ?? '', TODAY_ISO), 'bill due words');
  assert.doesNotThrow(() => F.billsMonthlyTotal(model.bills), 'monthly total');
  let forecast;
  assert.doesNotThrow(() => (forecast = F.financeForecast(model, { days: 90 })), 'forecast over odd bills');
  assert.doesNotThrow(() => F.affordCheck(forecast, 189.5), 'afford check');
  let docs;
  assert.doesNotThrow(() => (docs = D.documentsModel(notes, TODAY)), 'documents model');
  assert.ok(docs.documents.length >= 1, 'the odd document is read');
  assert.doesNotThrow(() => S.recordModules.documentRecords(docs), 'document records');
  for (const d of docs.documents) assert.doesNotThrow(() => D.expiryWords(d, TODAY_ISO), 'expiry words');
  assert.doesNotThrow(() => D.readDocument(modelNote(v.index, 'Me/Documents and ID/Passport (Sam).md'), TODAY_ISO), 'read document');
  for (const bad of ['soon', 'thirty', '', '2026-13-45', 4, 4.5, true, null, undefined, ['2026-10-27']]) {
    assert.doesNotThrow(() => F.readMoney(bad), `readMoney(${String(bad)})`);
    assert.doesNotThrow(() => F.readIsoDay(bad), `readIsoDay(${String(bad)})`);
    assert.doesNotThrow(() => F.readCycle(bad), `readCycle(${String(bad)})`);
    assert.doesNotThrow(() => F.dueWords(bad, TODAY_ISO), `dueWords(${String(bad)})`);
  }
  assert.equal(F.readMoney(189.5), 189.5);
  assert.equal(F.readIsoDay('2026-10-27'), '2026-10-27');
});

test('house, cars, career and trips render with odd days, amounts and tables', () => {
  const v = vaultOf(FILES);
  const notes = modelNotes(v.index);
  const H = S.house, V = S.vehicles, C = S.career, T = S.travel;
  let house, cars, career, trips;
  assert.doesNotThrow(() => (house = H.houseModel(notes, TODAY_ISO)), 'house model');
  assert.doesNotThrow(() => H.readHome(modelNote(v.index, 'Home/House/Home.md')), 'read home');
  assert.doesNotThrow(() => H.readAppliance(modelNote(v.index, 'Home/House/Appliances/Dishwasher.md'), TODAY_ISO, 60), 'read appliance');
  const job = modelNote(v.index, 'Home/House/Maintenance/Clean the gutters.md');
  let j;
  assert.doesNotThrow(() => (j = H.readJob(job, TODAY_ISO, 14)), 'read job');
  assert.doesNotThrow(() => H.jobWords(j, TODAY_ISO), 'job words');
  assert.doesNotThrow(() => (cars = V.vehiclesModel(notes, TODAY_ISO)), 'vehicles model');
  assert.ok(cars.vehicles.length >= 1, 'the odd vehicle is read');
  const veh = V.readVehicle(modelNote(v.index, 'Home/Vehicles/Runabout – 2019.md'), TODAY_ISO, 30);
  for (const d of veh.dues) assert.doesNotThrow(() => V.dueWords(d, TODAY_ISO), 'vehicle due words');
  assert.doesNotThrow(() => (career = C.careerModel(notes, TODAY_ISO)), 'career model');
  const app = C.readApplication(modelNote(v.index, 'Me/Career/Applications/Analyst at Brightwater.md'), TODAY_ISO, { cvs: [], letters: [] });
  for (const i of app.interviews) assert.doesNotThrow(() => C.interviewWords(i, TODAY_ISO), 'interview words');
  assert.doesNotThrow(() => (trips = T.travelModel(notes, TODAY_ISO)), 'travel model');
  const trip = T.readTrip(modelNote(v.index, 'Me/Travel/Trips/Harbour City – Nov 2026.md'), TODAY_ISO);
  assert.doesNotThrow(() => T.tripWhen(trip, TODAY_ISO), 'trip when');
  assert.doesNotThrow(() => T.tripRangeWords(trip), 'trip range');
  for (const bad of ODD_STR) {
    assert.doesNotThrow(() => H.interval(bad), `interval(${bad})`);
    assert.doesNotThrow(() => H.nextAfter(bad, TODAY_ISO), `nextAfter(${bad})`);
    assert.doesNotThrow(() => T.untilWords(bad, TODAY_ISO), `untilWords(${bad})`);
  }
  for (const bad of [...ODD_STR, 4, 4.5, true, false, null, undefined, ['2026-10-27']]) {
    assert.doesNotThrow(() => S.personalRecords.readTime(bad), `readTime(${String(bad)})`);
    assert.doesNotThrow(() => S.personalRecords.readAmount(bad), `readAmount(${String(bad)})`);
    assert.doesNotThrow(() => S.personalRecords.readNumber(bad), `readNumber(${String(bad)})`);
  }
  assert.doesNotThrow(() => V.vehicleName({ make: 4, model: true, year: [2019], rego: null }), 'odd vehicle name');
});

test('weekly, sites and suppliers render with odd weeks, dates and amounts', () => {
  const v = vaultOf(FILES);
  const notes = modelNotes(v.index);
  const W = S.weeklyUpdates, ST = S.workSites, VN = S.workVendors;
  const wtext = v.index.content('Work/Weekly Updates/Weekly update 2026-10-26.md');
  let weekly;
  assert.doesNotThrow(() => (weekly = W.readWeekly('Work/Weekly Updates/Weekly update 2026-10-26.md', wtext)), 'read weekly');
  assert.doesNotThrow(() => W.metricWords({ value: 4.5, unit: 'k' }), 'metric words');
  let sites;
  assert.doesNotThrow(() => (sites = ST.sitesModel(notes, TODAY_ISO)), 'sites model');
  assert.doesNotThrow(() => ST.readSite(modelNote(v.index, 'Work/Sites/Harbour Office.md'), TODAY_ISO), 'read site');
  const dev = ST.readDevice(modelNote(v.index, 'Work/Sites/Devices/Core switch.md'), TODAY_ISO, 90);
  assert.doesNotThrow(() => ST.lifeWords('warranty', dev.warranty ?? '', dev.warrantyDays ?? 0, TODAY_ISO), 'device life words');
  let vendors;
  assert.doesNotThrow(() => (vendors = VN.vendorsModel(notes, TODAY_ISO)), 'vendors model');
  assert.doesNotThrow(() => VN.readQuote(modelNote(v.index, 'Work/Vendors/Quotes/Ink cartridges Q3.md'), TODAY_ISO, 30), 'read quote');
  assert.doesNotThrow(() => VN.readOrder(modelNote(v.index, 'Work/Vendors/Orders/Order 1042.md'), TODAY_ISO), 'read order');
  assert.doesNotThrow(() => VN.readContract(modelNote(v.index, 'Work/Vendors/Contracts/Cleaning 2026.md'), TODAY_ISO, 30), 'read contract');
  assert.doesNotThrow(() => VN.compareQuotes(vendors.quotes ?? []), 'compare quotes');
  for (const bad of ODD_STR) assert.doesNotThrow(() => ST.dayWords(bad, TODAY_ISO), `site dayWords(${bad})`);
  for (const bad of [...ODD_STR, 4, true, null, undefined]) {
    assert.doesNotThrow(() => W.readDayWords(bad), `readDayWords(${String(bad)})`);
    assert.doesNotThrow(() => W.flagOf(bad), `flagOf(${String(bad)})`);
  }
});

test('memories, business and systems render with odd days, people and tables', () => {
  const v = vaultOf(FILES);
  const notes = modelNotes(v.index);
  const MM = S.memories, B = S.business, SY = S.systems;
  let memories;
  assert.doesNotThrow(() => (memories = MM.memoriesModel(notes, TODAY_ISO)), 'memories model');
  assert.doesNotThrow(() => MM.readAlbum(modelNote(v.index, 'Me/Memories/Albums/Beach – 2024.md')), 'read album');
  const album = MM.readAlbum(modelNote(v.index, 'Me/Memories/Albums/Beach – 2024.md'));
  assert.doesNotThrow(() => MM.readCreative(modelNote(v.index, 'Me/Memories/Projects/Library poster.md'), TODAY_ISO, [album]), 'read creative');
  let business;
  assert.doesNotThrow(() => (business = B.businessModel(notes, TODAY_ISO)), 'business model');
  assert.doesNotThrow(() => B.businessWeekWords(business), 'business week words');
  let systems;
  assert.doesNotThrow(() => (systems = SY.systemsModel(notes, TODAY_ISO)), 'systems model');
  for (const bad of ODD_STR) assert.doesNotThrow(() => SY.nextRunOf(bad, null, TODAY_ISO), `nextRunOf(${bad})`);
});

test('health and family words never throw on odd measures, days and times', () => {
  const HH = S.health, F = S.family;
  for (const bad of [...ODD_STR, '25:99']) {
    assert.doesNotThrow(() => HH.dayWords(bad, TODAY_ISO), `health dayWords(${bad})`);
    assert.doesNotThrow(() => HH.whenWords(bad, TODAY_ISO), `health whenWords(${bad})`);
    assert.doesNotThrow(() => HH.timeWords(bad), `health timeWords(${bad})`);
    assert.doesNotThrow(() => F.readDays(bad), `readDays(${bad})`);
    assert.doesNotThrow(() => F.readTime(bad), `readTime(${bad})`);
    assert.doesNotThrow(() => F.readDate(bad, TODAY_ISO), `readDate(${bad})`);
  }
  for (const bad of [...ODD_STR, undefined]) {
    assert.doesNotThrow(() => F.ageOn(bad, TODAY_ISO), `ageOn(${String(bad)})`);
    assert.doesNotThrow(() => F.nextBirthday(bad, TODAY_ISO), `nextBirthday(${String(bad)})`);
  }
  assert.doesNotThrow(() => HH.timeWords(undefined), 'health timeWords(undefined)');
  assert.equal(HH.dayWords(TODAY_ISO, TODAY_ISO), 'Sat 31 Oct');
  assert.equal(HH.whenWords(TODAY_ISO, TODAY_ISO), 'today');
  const cal = '## Calendar\n\n| Day | Time | Who | What |\n| --- | --- | --- | --- |\n| 2026-10-31 | 3:00 PM | Sam | Swimming |\n| soon | breakfast | Ana | Baking |\n';
  assert.doesNotThrow(() => F.readCalendar(cal, TODAY_ISO), 'read calendar with an odd row');
  assert.doesNotThrow(() => F.readMember('People/Ana – Jones.md', 'Ana – Jones', { born: 19900412, colour: ['red'] }), 'read member with odd props');
});

test('every Needs strip renders with odd record data (names, days, amounts, links)', () => {
  const MP = S.modulePurpose;
  const oddDay = 'soon';
  const oddName = 'Ana – [[Harbour Bakery|Bakery]]';
  assert.doesNotThrow(() => MP.financeNeeds([{ name: oddName, next: oddDay, amount: NaN }, { name: '', next: null, amount: null, autopay: true }], TODAY_ISO), 'finance needs');
  assert.doesNotThrow(() => MP.documentsNeeds([{ name: oddName, expires: oddDay }, { name: '', expires: null }], TODAY_ISO), 'documents needs');
  assert.doesNotThrow(() => MP.sitesNeeds([{ device: oddName, what: 'Warranty', date: oddDay }], [{ title: '', due: null }], TODAY_ISO), 'sites needs');
  assert.doesNotThrow(() => MP.vendorsNeeds([{ name: oddName, validUntil: oddDay, amount: -5, open: true }], [{ name: '', ends: null }], TODAY_ISO), 'vendors needs');
  assert.doesNotThrow(() => MP.weeklyNeeds({ week: oddDay, status: 'Draft' }, TODAY_ISO, null, TODAY_ISO), 'weekly needs');
  assert.doesNotThrow(() => MP.businessNeeds([{ name: oddName, date: oddDay }], [{ title: '', received: null }], TODAY_ISO), 'business needs');
  assert.doesNotThrow(() => MP.systemsNeeds([{ name: oddName, nextDue: oddDay }], [{ name: '', status: '' }], TODAY_ISO), 'systems needs');
  assert.doesNotThrow(() => MP.goalsNeeds([{ title: oddName, due: oddDay }], [{ name: '' }], [{ name: oddName, nextDue: null }], TODAY_ISO), 'goals needs');
  assert.doesNotThrow(() => MP.memoriesNeeds([{ name: oddName, due: oddDay, status: '' }], TODAY_ISO), 'memories needs');
  assert.doesNotThrow(() => MP.listsNeeds([{ title: oddName }], TODAY_ISO), 'lists needs');
  assert.doesNotThrow(() => MP.careerNeeds([{ name: oddName, nextDate: oddDay }], [{ name: '', date: null }], TODAY_ISO), 'career needs');
  assert.doesNotThrow(() => MP.travelNeeds([{ name: oddName, starts: oddDay, phase: '' }], TODAY_ISO), 'travel needs');
  assert.doesNotThrow(() => MP.houseNeeds([{ name: oddName, nextDue: oddDay }], [{ name: '', warranty: null }], TODAY_ISO), 'house needs');
  assert.doesNotThrow(() => MP.vehiclesNeeds([{ vehicle: oddName, what: 'Rego', date: oddDay }], TODAY_ISO), 'vehicles needs');
  assert.doesNotThrow(() => MP.publicationsNeeds({ label: 'No. – 4', date: oddDay, status: '' }, TODAY_ISO), 'publications needs');
  assert.doesNotThrow(() => MP.familyNeeds([{ what: oddName, date: oddDay }], [{ name: '', day: oddDay }], TODAY_ISO), 'family needs');
  assert.doesNotThrow(() => MP.healthNeeds([{ title: oddName, date: oddDay }], true, [{ name: '' }], TODAY_ISO), 'health needs');
  const cards = MP.goalsNeeds([{ title: oddName, due: oddDay }], [], [], TODAY_ISO);
  assert.doesNotThrow(() => MP.attentionOrder(cards, TODAY_ISO), 'attention order');
  assert.doesNotThrow(() => MP.selectNeeds(cards, TODAY_ISO), 'select needs');
  assert.doesNotThrow(() => MP.nextNeedsDate(cards, TODAY_ISO), 'next needs day');
  assert.doesNotThrow(() => MP.nothingNeedsYou(MP.nextNeedsDate(cards, TODAY_ISO), TODAY_ISO), 'nothing-needs words');
});
