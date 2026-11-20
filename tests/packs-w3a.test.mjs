// node --test tests/packs-w3a.test.mjs — 8.7 Vault redesign wave 3a (30 Oct 2026): the work-half packs (Money, Papers,
// Business, Suppliers, Systems, Sites, Publications, Career, Meetings) as normal pages in the one page shape, each
// wired to its real data and actions. Every rule a test can check gets one: the shared rules stay true (a machine never
// checked is never up or Good, quotes compare by price, an application's prep sheet is kept properties), every pack
// page keeps its abilities (add, edit where it shows or in its note, delete to Recently deleted, find it in search),
// and the w3a-only styles use theme tokens, never cream or engine names. Made-up names and amounts only.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-packs-w3a-'));
let S;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'shared.ts');
  const mods = ['systems', 'work-vendors', 'career', 'life-modules'];
  writeFileSync(entry, mods.map((m) => `export * as ${m.replace(/-(\w)/g, (_, c) => c.toUpperCase())} from ${JSON.stringify(path.join(root, 'src/shared', `${m}.ts`))};`).join('\n'));
  await build({ input: entry, platform: 'node', external: ['yaml'], output: { file: path.join(work, 's.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try { symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction'); } catch {}
  S = await import(pathToFileURL(path.join(work, 's.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const src = (rel) => readFileSync(path.join(root, rel), 'utf8');
const RENDER = 'src/renderer/src/views/modules';
const CHANGED = [
  `${RENDER}/pack87.tsx`,
  `${RENDER}/RecordModulePage.tsx`,
  `${RENDER}/life/BusinessPage.tsx`,
  `${RENDER}/life/SystemsPage.tsx`,
  `${RENDER}/work/VendorsPage.tsx`,
  `${RENDER}/work/SitesPage.tsx`,
  `${RENDER}/PublicationsPage.tsx`,
  `${RENDER}/personal/CareerPage.tsx`,
  `${RENDER}/work/MeetingsPage.tsx`,
];

test('systems: a machine never checked is never up or Good (grey Not checked yet)', () => {
  const fresh = { status: 'Up', checked: null, address: '10.0.0.2', health: [], credentials: [], plain: 0 };
  assert.equal(S.systems.machineState(fresh).words, 'Not checked yet');
  assert.equal(S.systems.machineTone({ machines: [], services: [], trouble: [], today: '2026-10-30' }, fresh), 'none');
  const page = src(`${RENDER}/life/SystemsPage.tsx`);
  assert.match(page, /Not checked yet/);
  assert.match(page, /Needs you/);
  assert.match(page, /Add its login/);
});

test('systems: a checked machine still reads Good, At risk or Down', () => {
  const ok = { status: 'Up', checked: '2026-10-30', address: '10.0.0.2', health: [], credentials: [], plain: 0 };
  assert.equal(S.systems.machineTone({ machines: [], services: [], trouble: [], today: '2026-10-30' }, ok), 'ok');
  const down = { status: 'Down', checked: '2026-10-30', address: '10.0.0.2', health: [], credentials: [], plain: 0 };
  assert.equal(S.systems.machineTone({ machines: [], services: [], trouble: [], today: '2026-10-30' }, down), 'bad');
});

test('vendors: quotes compare by price, the lowest marked Best price', () => {
  const a = { path: 'a.md', items: [], amount: 4200, itemsTotal: null, currency: 'AUD', validUntil: '2026-11-21', days: 22, state: 'Valid', open: true, vendor: 'A' };
  const b = { path: 'b.md', items: [], amount: 3890, itemsTotal: null, currency: 'AUD', validUntil: '2026-11-09', days: 10, state: 'Lapses soon', open: true, vendor: 'B' };
  const c = S.workVendors.compareQuotes([a, b]);
  assert.equal(c.cheapest, 'b.md');
  const page = src(`${RENDER}/work/VendorsPage.tsx`);
  assert.match(page, /Best price/);
  assert.match(page, /Lapses soon/);
});

test('vendors: an order reads raised to paid, approved as ordered', () => {
  const page = src(`${RENDER}/work/VendorsPage.tsx`);
  assert.match(page, /Raised to paid/);
  // 9.2 uplift F44: one stage map, so a raised order highlights Raised (approved reads as ordered).
  assert.match(page, /ORDER_STAGES/);
  assert.match(page, /label: 'Ordered', at: \(s\) => s === 'Approved'/);
  assert.match(page, /Mark delivered/);
  assert.match(page, /Mark paid/);
});

test('career: the prep sheet is kept properties, read back on the application', () => {
  const fields = S.career.APPLICATION_PROPS.map((p) => p.field);
  for (const f of ['prep_role', 'prep_questions', 'prep_ask']) assert.ok(fields.includes(f), `keeps ${f}`);
  const page = src(`${RENDER}/personal/CareerPage.tsx`);
  assert.match(page, /Prep sheet/);
  assert.match(page, /prep_role/);
  assert.match(page, /prep_questions/);
  assert.match(page, /prep_ask/);
});

test('career: the board drags an application to move it on', () => {
  const page = src(`${RENDER}/personal/CareerPage.tsx`);
  assert.match(page, /Applications board/);
  assert.match(page, /text\/career-application/);
  assert.match(page, /moveStage\(a, s\)/);
});

test('finance: bills split from subscriptions, ticked where they show', () => {
  const page = src(`${RENDER}/RecordModulePage.tsx`);
  // 9.5 fvault F5: every bill, soonest first, under Bills beside Subscriptions; never "DUE NOW" over bills months out.
  assert.match(page, /<PackSection label="Bills">/);
  assert.doesNotMatch(page, /label="DUE NOW"/);
  assert.match(page, /Subscriptions/);
  assert.match(page, /See every bill as a table/);
  assert.match(page, /markPaid\(b\)/);
});

test('finance: the next 90 days reads the forecast and tests a cost', () => {
  const page = src(`${RENDER}/RecordModulePage.tsx`);
  assert.match(page, /Next 90 days/);
  assert.match(page, /Balance by week/);
  assert.match(page, /Can we afford it/);
  assert.match(page, /affordCheck\(fc, amount\)/);
});

test('finance: a budget near full reads amber, like the mock-up', () => {
  const page = src(`${RENDER}/RecordModulePage.tsx`);
  assert.match(page, /' near'/);
  const css = src('src/renderer/src/styles/packs-87.css');
  assert.match(css, /\.p87-meter\.near/);
});

test('documents: the expiry reminder reads the document’s own days', () => {
  const page = src(`${RENDER}/RecordModulePage.tsx`);
  assert.match(page, /reminder \$\{plural\(d\.remind, 'day'\)\} before/); // one plural rule (10.0 fourth round G5-G7)
  assert.match(page, /kept for reference/);
});

test('documents: each document has its own page, its number locked', () => {
  const page = src(`${RENDER}/RecordModulePage.tsx`);
  assert.match(page, /doc:\$\{encodeURIComponent/);
  assert.match(page, /Expiring soon/);
  assert.match(page, /Every document by kind/);
  assert.match(page, /documentNumber\(d\)/);
  assert.match(page, /Locked away/);
});

test('business: a support item reads its thread, its next step, its details', () => {
  const page = src(`${RENDER}/life/BusinessPage.tsx`);
  assert.match(page, /label="Thread"/);
  assert.match(page, /label="Next"/);
  assert.match(page, /SUPPORT_PRIORITIES/);
  assert.match(page, /draftInChat\(/);
});

test('round 3: a support item says Status, Customer and About once, at the top', () => {
  const page = src(`${RENDER}/life/BusinessPage.tsx`);
  assert.match(page, /k: 'Status'/, 'Status is a top fact');
  assert.match(page, /k: 'Customer'/, 'Customer is a top fact');
  assert.match(page, /k: 'About'/, 'About is a top fact');
  const details = page.slice(page.indexOf('label="Details"'));
  assert.doesNotMatch(details, /<span className="k">Status<\/span>/, 'no Status row in Details');
  assert.doesNotMatch(details, /<span className="k">Customer<\/span>/, 'no Customer row in Details');
  assert.doesNotMatch(details, /<span className="k">Product<\/span>/, 'no Product row in Details');
  assert.doesNotMatch(details, /<span className="k">Version<\/span>/, 'no Version row in Details');
  assert.match(details, /<span className="k">Priority<\/span>/, 'Priority stays editable in Details');
  assert.match(details, /<span className="k">Came in<\/span>/, 'Came in stays editable in Details');
  assert.match(details, /<span className="k">Came by<\/span>/, 'Came by stays editable in Details');
});

test('sites: the register reads sites then patch work, jobs ticked live where they show', () => {
  const page = src(`${RENDER}/work/SitesPage.tsx`);
  assert.match(page, /Rooms, gear, serials, patch points and photos for each site/);
  assert.ok(page.indexOf('label="Sites"') < page.indexOf('Patch work to do'), 'sites before patch work');
  assert.match(page, /All live/);
  assert.match(page, /to patch/);
  assert.match(page, /Mark live/);
  assert.match(page, /Tick label=\{`Mark \$\{x\.point\} live`\}/);
  assert.match(page, /label: 'Delete', icon: 'trash', danger: true/);
});

test('sites: a site reads its devices and patch panel, each point edited where it shows', () => {
  const page = src(`${RENDER}/work/SitesPage.tsx`);
  assert.match(page, /Patch points · \$\{panel\}/);
  assert.match(page, /Photos with each device/);
  assert.match(page, /mapped \$\{shortDay\(x\.date\)\}/);
  assert.match(page, /SitePatchRow/);
  assert.match(page, /warranty to \$\{warrantyShort/);
});

test('publications: every edition lists newest first, each with its own page', () => {
  const page = src(`${RENDER}/PublicationsPage.tsx`);
  assert.match(page, /edition:\$\{e\.path\}/);
  assert.match(page, /Page plan/);
  assert.match(page, /Pieces and puzzles for/);
  assert.match(page, /Build the PDF/);
  assert.match(page, /kept/);
  assert.match(page, /Search every edition…/);
});

test('career: a saved card reads its closing day, the CV its catalogue home', () => {
  const page = src(`${RENDER}/personal/CareerPage.tsx`);
  assert.match(page, /closes \$\{shortDay\(a\.nextDate\)\}/);
  assert.match(page, /packName\('documents', 'Papers'\)\} · CV versions/);
});

test('vendors: contracts end in a month, orders arrive on a weekday', () => {
  const shell = src(`${RENDER}/pack87.tsx`);
  // The day words live guarded in one shared place since 8.7.1 (31 Oct 2026, pages that "couldn't show"); the pack
  // shell re-exports them, so every pack page keeps its words from this one shape.
  assert.match(shell, /export \{[^}]*monthYear[^}]*\} from '..\/..\/..\/..\/shared\/pack-dates'/);
  assert.match(shell, /export \{[^}]*weekdayLong[^}]*\} from '..\/..\/..\/..\/shared\/pack-dates'/);
  const page = src(`${RENDER}/work/VendorsPage.tsx`);
  assert.match(page, /contract to \$\{monthYear/);
  assert.match(page, /Arrives \$\{o\.delivery <= daysAhead\(m\.today, 7\) \? weekdayLong/);
});

test('w3a rows: menus on right-click, never a dots button on the row', () => {
  for (const rel of CHANGED.slice(1)) {
    const body = src(rel);
    assert.doesNotMatch(body, /RowDots/);
  }
});

test('meetings: settings are real switches, and nothing carries any more', () => {
  const page = src(`${RENDER}/work/MeetingsPage.tsx`);
  assert.match(page, /packName\('meetings', 'Meetings'\)\} settings/);
  assert.match(page, /Prep packs/);
  assert.match(page, /setModule\('meetings', !prepOn, 'prep'\)/);
  // t238: the carry switch and its confirm are gone — a meeting's actions are its project's tasks already.
  assert.doesNotMatch(page, /askBeforeCarry/);
  assert.doesNotMatch(page, /confirm\(`Carry/);
  assert.match(page, /className="packrow"/);
  assert.match(page, /What is open with the people coming/);
  // Round 4 join with main: main's list is the one Meetings place, so the round's second list is gone (its
  // coming, carry and series rows); the settings page, short name, tour and series stay, series as cards.
  assert.doesNotMatch(page, /ACTIONS STILL TO CARRY INTO A PROJECT/);
  assert.doesNotMatch(page, /with prep packs ready/);
  assert.doesNotMatch(page, /SeriesTrow|ComingRow|CarryRow/);
  assert.match(page, /function SeriesCards/);
});

test('meetings: the joined list rows lead with the day in words', () => {
  const page = src(`${RENDER}/work/MeetingsPage.tsx`);
  // Round 4 join with main: the round's coming rows are gone with its second list; main's rows lead with the
  // day in words. (The .p87 .trow .day style they used stays in the sheet, now unused.)
  assert.doesNotMatch(page, /<span className="day">\{day\}<\/span>/);
  assert.match(page, /meetingDayLabel\(m\.date, today\)/);
});

test('packs off: hidden from the side bar, their files kept', () => {
  const registry = src(`${RENDER}/registry.ts`);
  assert.match(registry, /is switched off/);
  assert.match(registry, /Everything it holds is kept/);
  assert.ok(!S.lifeModules.moduleOn({ career: false }, 'career'));
});

test('w3a styles: theme tokens only, never cream, never engine names', () => {
  const css = src('src/renderer/src/styles/packs-87.css');
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(bare, /#[0-9a-fA-F]{3,8}/);
  assert.doesNotMatch(bare, /cream|faf8f4/i);
  for (const rel of CHANGED) {
    const body = src(rel);
    assert.doesNotMatch(body, /DeepSeek|deepseek/i);
    assert.doesNotMatch(body, /#faf8f4/i);
  }
});

test('w3a pages: every pack page carries the one menu', () => {
  for (const rel of CHANGED.slice(1)) {
    const body = src(rel);
    assert.match(body, /menu=\{\(\) => /);
  }
});

test('round 2: pack pages use the full width, never the narrow column', () => {
  const shell = src(`${RENDER}/pack87.tsx`);
  // The full width stands; a pack page with a list may add its detail beside it (20 Nov 2026, has-split), never
  // the narrow reading column.
  assert.match(shell, /className=\{`nv-page full p87\$\{wide \? ' has-split' : ''\}`\}/);
  assert.doesNotMatch(shell, /nv-page read/);
  for (const rel of CHANGED.slice(1)) {
    assert.doesNotMatch(src(rel), /nv-page read p87/);
  }
});

test('round 2: no inline Show me around link; the tour lives in the menu and the palette', () => {
  for (const rel of CHANGED.slice(1)) {
    const body = src(rel);
    assert.doesNotMatch(body, /ModuleTour/);
    assert.doesNotMatch(body, /PackTour/);
    assert.match(body, /Show me around \$\{name\}/);
    assert.match(body, /openTour\(/);
  }
  const commands = src('src/renderer/src/state/commands.ts');
  for (const id of ['finance', 'documents', 'business', 'vendors', 'systems', 'sites', 'publications', 'career', 'meetings']) {
    assert.match(commands, new RegExp(`id: 'tour-${id}'`));
    assert.match(commands, new RegExp(`openTour\\('${id}'\\)`));
  }
  const registry = src(`${RENDER}/registry.ts`);
  assert.match(registry, /ModuleTour, \{ module: info, link: false \}/);
});

test('round 2: pack names come from the catalogue, never hard-coded', () => {
  const shell = src(`${RENDER}/pack87.tsx`);
  assert.match(shell, /export const packName/);
  const packs = [
    [`${RENDER}/RecordModulePage.tsx`, ['finance', 'documents']],
    [`${RENDER}/life/BusinessPage.tsx`, ['business']],
    [`${RENDER}/life/SystemsPage.tsx`, ['systems']],
    [`${RENDER}/work/VendorsPage.tsx`, ['vendors']],
    [`${RENDER}/work/SitesPage.tsx`, ['sites']],
    [`${RENDER}/PublicationsPage.tsx`, ['publications']],
    [`${RENDER}/personal/CareerPage.tsx`, ['career']],
    [`${RENDER}/work/MeetingsPage.tsx`, ['meetings']],
  ];
  for (const [rel, ids] of packs) {
    const body = src(rel);
    for (const id of ids) assert.match(body, new RegExp(`packName\\(('${id}'|MOD),`));
  }
  // No hard-coded pack title or overview menu label survives in the w3a pages.
  for (const rel of CHANGED.slice(1)) {
    const body = src(rel);
    assert.doesNotMatch(body, /title="(Money|Papers|Business|Suppliers|Systems|Sites|Publications|Career|Meetings)"/);
    assert.doesNotMatch(body, /label: '(Money|Papers|Business|Suppliers|Systems|Sites|Publications|Career|Meetings)'/);
  }
});

test('round 2: pack titles wrap at word edges, never cut mid-word', () => {
  const css = src('src/renderer/src/styles/packs-87.css');
  assert.match(css, /\.p87 \.nv-page-name/);
  assert.match(css, /overflow-wrap: normal/);
  assert.match(css, /word-break: normal/);
});

test('round 2: board cards never tag the stage they sit in', () => {
  const page = src(`${RENDER}/personal/CareerPage.tsx`);
  assert.match(page, /return null;\n  \}\n  if \(a\.stage === 'Applied'\)/);
  assert.doesNotMatch(page, /words: '(Interview|Applied|Offer|Saved)'/);
  assert.match(page, /\{tag \? \(\n        <div className="tags">/);
});

test('round 3: the work packs use the short names, and the old names still find them', () => {
  const catalogue = src('src/shared/life-modules.ts');
  for (const [id, name] of [['finance', 'Money'], ['documents', 'Papers'], ['business', 'Business'], ['vendors', 'Suppliers'], ['systems', 'Systems'], ['sites', 'Sites'], ['publications', 'Publications'], ['career', 'Career'], ['meetings', 'Meetings']]) {
    assert.ok(catalogue.includes(`id: '${id}',\n    name: '${name}'`), `${id} is called ${name}`);
  }
  for (const old of ['Finance', 'Documents and ID', 'Vendors, Quotes and Contracts', 'Vendors Quotes and Contracts', 'Systems and Home Lab', 'Sites and Equipment']) {
    assert.ok(catalogue.includes(`'${old}'`), `the catalogue still answers to ${old}`);
  }
  const search = src('src/renderer/src/lib/settingsSearch.ts');
  assert.ok(search.includes('moduleEntries'), 'Settings search lists every pack with its earlier names');
  for (const [file, id, name] of [['src/shared/module-records.ts', 'finance', 'Money'], ['src/shared/module-records.ts', 'documents', 'Papers'], ['src/shared/work-modules.ts', 'sites', 'Sites'], ['src/shared/work-modules.ts', 'vendors', 'Suppliers'], ['src/shared/life-records.ts', 'systems', 'Systems']]) {
    const rec = src(file);
    assert.ok(rec.includes(`id: '${id}',\n  name: '${name}'`), `${file} calls ${id} ${name}`);
  }
  const cards = src('src/shared/home-cards.ts');
  assert.ok(cards.includes(`module: 'finance', name: 'Money'`), 'Home bills card names Money');
});

test('round 4 join with main: one Meetings place, one tour opener, a settings page that opens', () => {
  const page = src(`${RENDER}/work/MeetingsPage.tsx`);
  // Main's list is the base (stats, chips, the week beside it on Calendar, one meeting page in three states).
  for (const bit of ['meetingStats(view.meetings', 'Upcoming', 'WeekCalendar', 'BeforeMeeting', 'LiveMeeting', 'AfterMeeting']) assert.ok(page.includes(bit), `main's Meetings keeps ${bit}`);
  // The round's settings page is reached, not just rendered: placeOf knows settings, the list menu opens it.
  assert.match(page, /placeOf\(tab, MEETINGS, \[\.\.\.sections, \{ id: 'settings'/);
  assert.match(page, /section === 'settings' \? \(\n {10}<SettingsPage view=\{view\} canEdit=\{canEdit\} \/>/);
  assert.match(page, /openModule\('meetings', 'settings'\)/);
  // One "Show me around" mechanism: the page's own asker is an openTour opener, the ⋯ menu and the palette's one
  // tour command go through openTour, and the host mounts beside the page (meetings tabs never see the registry).
  // The w2b 'meetings-tour' said the same words as the packs' tour-meetings (8.7 final polish, one Meetings place),
  // so only the packs' one stays.
  assert.match(page, /export const askMeetingsTour = \(\) => openTour\('meetings'\);/);
  assert.doesNotMatch(page, /TourHost|tourAsked/);
  const commands = src('src/renderer/src/state/commands.ts');
  assert.match(commands, /id: 'tour-meetings', name: `Show me around \$\{moduleInfo\('meetings'\)\?\.name \?\? 'Meetings'\}`, icon: 'help', run: \(\) => \{ openModule\('meetings'\); openTour\('meetings'\); \}/);
  assert.doesNotMatch(commands, /id: 'meetings-tour'/);
  assert.doesNotMatch(commands, /askMeetingsTour/);
  const workspace = src('src/renderer/src/views/Workspace.tsx');
  assert.match(workspace, /const meetings = moduleInfo\('meetings'\);/);
  assert.match(workspace, /\{meetings && <ModuleTour module=\{meetings\} link=\{false\} \/>\}/);
});
