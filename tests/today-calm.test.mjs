// node --test tests/today-calm.test.mjs — Today on one calm screen (8 Nov 2026, calm Today). Today becomes
// one calm screen you take in at a glance: the date and greeting, one plain line of what matters, Next for
// you (5), today's meetings, and one quiet line ("N things need a look") opening the full list. Every former
// block is a row in that list, worded and opening as now; pack offers leave Today for Settings › Packs;
// empty blocks go; area chips show only areas with notes; "waiting from your notes" counts real tasks on a
// project; past 2400px the reading column widens. Source checks plus the live harness: a made-up vault as
// busy as theirs (14 projects, a 100-box linked project, 3 bills, 4 systems, meetings), pictured shut and
// open at 3456x1408, 1920x1117 and 1219x709 in ../shots/.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shotsDir = path.join(root, '..', 'shots');

// ── One quiet line for the full list ─────────────────────────────────────────

test('one Also section past Meetings, remembered; never the old naming', () => {
  // Step 2 (12 Nov 2026): the whisper line is one Also fold that looks like a section.
  const src = read('src/renderer/src/views/TodayView.tsx');
  assert.ok(src.includes('data-section="also"') && src.includes('td-h-also'), 'one Also section');
  assert.ok(!src.includes('things need a look'), 'never the whisper line any more');
  assert.ok(!src.includes('Show everything else'), 'never the old naming any more');
  assert.ok(!src.includes('elseWords'), 'never the old naming words');
  assert.ok(src.includes('keepElseOpen(open)') && src.includes("localStorage.getItem(ELSE_KEY)"), 'a person’s own open-or-shut stays remembered');
  assert.ok(src.includes('Show fewer'), 'open, it still says Show fewer');
  assert.ok(src.includes('All tasks'), 'All tasks stays beside the head');
});

// ── Every former block is a row in the list ──────────────────────────────────

test('the nags, the vault, the projects waiting, the packs and the cards list as rows', () => {
  // Layout rounds 2 and 3 (20 Nov 2026) re-laid the calm screen: the rows that once sat inside the Also fold now
  // read in Needs you (the nags, projects waiting, upkeep and the live hub), the packs' own blocks (due, the
  // turned-on cards) stand as blocks of their own beside it and count with it, the vault's line sits at the foot of
  // the day, and the work sections fold inside More for today (data-section="also"). The meetings to prep left for
  // the one Meetings card (2.0.1). What this protects stays: every former block is a counted row in one place,
  // and nothing stands past the quiet line (updated 23 Nov 2026).
  const src = read('src/renderer/src/views/TodayView.tsx');
  const at = (mark, from = 0) => {
    const i = src.indexOf(mark, from);
    assert.ok(i >= 0, `${mark} is on the page`);
    return i;
  };
  const needs = at('data-section="needs"');
  const items = at('td-look-items', needs);
  const also = at('data-section="also"');
  const foot = at('data-section="vault"');
  assert.ok(needs < items && items < also, 'the rows live in Needs you, before More for today');
  // The nags and loose ends (worded as now, opening as now): the review and dormant lines (tidy left
  // Today for the weekly review, 8 Nov 2026 calm list).
  for (const nag of ['reviewQuiet', 'dormantQuiet']) {
    const i = at(`{isToday && ${nag}}`);
    assert.ok(i > items && i < also, `${nag} lists with the rows`);
  }
  assert.ok(src.includes('data-look-row'), 'the nags count as rows');
  // The projects waiting and the packs, as rows under their own words, each in a counted list.
  for (const block of ['<ProjectChecksToday />', '<TodayModules group="upkeep"', '<TodayModules group="due"', '<TodayModules group="rest"', '<LookCards']) {
    const i = at(block);
    assert.ok(i > items && i < also, `${block} lists with the rows`);
    assert.ok(src.lastIndexOf('td-look-items', i) > needs, `${block} sits in a counted list`);
  }
  assert.ok(!src.includes('<TodayModules group="waiting"'), 'meetings to prep read in the one Meetings card, never twice');
  // The live hub is one click away in the list too, never blocks on the calm screen.
  for (const live of ['<ChangesWaiting />', '<CardsDue />']) {
    const i = at(live);
    assert.ok(i > items && i < also, `${live} folds inside Needs you`);
  }
  // The vault's own line at the day's foot.
  assert.ok(at('<VaultTodayCards />') > foot, 'the vault reads as the day’s foot line');
  // The work sections fold inside More for today: built into its list, shown only once it is open.
  const more = at('const moreForToday: BalanceItem[] = [];');
  assert.ok(at('id="waiting"') > more && at('id="waiting"') < needs, 'waiting folds inside More for today');
  assert.ok(src.includes('...(elseOpen ? moreForToday : [])'), 'More for today shows its sections only when open');
  // Nothing stands past the fold any more.
  const tail = src.slice(src.indexOf('Everything else lives in the one fold above'));
  assert.ok(!tail.includes('<VaultTodayCards') && !tail.includes('<ProjectChecksToday') && !tail.includes('<TodayModules'), 'no block stands past the quiet line');
});

test('a vault row and a turned-on card open to their full card, unchanged', () => {
  // The row carries the card's own title words; the card itself renders inside with every button it had.
  for (const [f, rows] of [
    ['src/renderer/src/components/VaultPlace.tsx', [['Found your vault in', 'Open it'], ['only on this PC', 'Move this folder', 'Not now']]],
    ['src/renderer/src/components/VaultHome.tsx', [['warning.title', 'Move it to', 'Not now']]],
    ['src/renderer/src/components/VaultSync.tsx', [['m.title', 'Sync details']]],
  ]) {
    const src = read(f);
    assert.ok(src.includes('<LookRow'), `${f} rows through LookRow`);
    for (const words of rows) for (const w of words) assert.ok(src.includes(w), `${f} keeps ${w}`);
  }
  const today = read('src/renderer/src/views/TodayView.tsx');
  assert.ok(today.includes('<LookRow key={id} title={titleOf(id)}>'), 'a turned-on card rows through LookRow');
  const row = read('src/renderer/src/components/LookRow.tsx');
  assert.ok(row.includes('data-look-row'), 'the row counts once, shut or open');
  assert.ok(row.includes('<details') && row.includes('<summary'), 'a details, so no state');
});

// ── Offers leave Today for Settings › Packs ──────────────────────────────────

test('no switch-on offer shows on Today; offers belong in Settings › Packs', () => {
  const modules = read('src/renderer/src/views/today/TodayModules.tsx');
  assert.ok(!modules.includes('ModuleOffers'), 'Today renders no offer');
  const rec = read('src/renderer/src/views/modules/RecordModulesToday.tsx');
  assert.ok(!rec.includes('ModuleOffers'), 'the offer card is gone, not just unused');
  assert.ok(!read('src/renderer/src/views/TodayView.tsx').includes('could help'), 'no offer words on Today');
  const css = read('src/renderer/src/styles/record-modules.css');
  assert.ok(!css.includes('.rm-offer'), 'no offer styles left behind');
  // In Packs, an off pack the vault would use says why under its line; the switch takes it, Hide suggestion puts it away.
  const packs = read('src/renderer/src/components/ModulesSettings.tsx');
  assert.ok(packs.includes('recmod.offers(inbox)'), 'the same read Today offered from');
  assert.ok(packs.includes('offer.why'), 'each off pack says why under its line');
  assert.ok(packs.includes('Hide suggestion'), 'Hide suggestion puts it away');
  assert.ok(packs.includes("setOptions(module, { dismissed: true })"), 'put away for good');
  assert.ok(read('src/renderer/src/styles/settings-87.css').includes('.ms-offer'), 'the why-line reads quiet');
});

// ── The count reads rendered rows ────────────────────────────────────────────

test('the line counts rendered kinds: every section and every marked row, expansions once', () => {
  const src = read('src/renderer/src/views/TodayView.tsx');
  assert.ok(src.includes('useLookCount(lookEl)'), 'the line counts from what rendered');
  assert.ok(src.includes('section[data-section]'), 'each section counts once (8 Nov 2026 calm list: one per kind)');
  assert.ok(!src.includes('li:not(details li)'), 'never one per item any more');
  assert.ok(src.includes('[data-look-row]'), 'every other row carries the mark');
  assert.ok(src.includes('MutationObserver'), 'openings recount');
  // The mark sits on nags, vault states that need the person, and card rows — never on status lines.
  assert.ok(src.includes('className="td-quiet-line" data-look-row'), 'the nags count');
  assert.ok(!read('src/renderer/src/views/today/SetupLine.tsx').includes('data-look-row'), 'the set-up nudge never counts');
  const sync = read('src/renderer/src/components/VaultSync.tsx');
  assert.ok(sync.includes('<LookRow'), 'a sync card that needs the person counts');
  const quiet = sync.split('vs-today quiet')[1].split('</div>')[0];
  assert.ok(!quiet.includes('data-look-row'), 'the all-well sync line never counts');
});

// ── Chips, counts and the wide column ────────────────────────────────────────

test('chips wire the areas that hold something; linked notes wire out of waiting', () => {
  const chips = read('src/renderer/src/views/today/TodayAreas.tsx');
  assert.ok(chips.includes('todayChips(config.areas, counts)'), 'only areas that hold something chip');
  assert.ok(chips.includes('countChipAreas(items,'), 'from the vault’s notes, never the app’s scaffolding');
  assert.ok(chips.includes('All areas'), 'All areas stays, so a choice left on an emptied area is one click off');
  const main = read('src/main/project-checks.ts');
  assert.ok(main.includes('linked: true'), 'bare links arrive marked');
  const shared = read('src/shared/project-checks.ts');
  assert.ok(shared.includes('!n.linked'), 'the shared rule drops them');
});

test('Today takes the frame like every room, and its sections balance into columns', () => {
  // Layout round 2 (compose.css, 20 Nov 2026) replaced the 2400 column and Also's paired groups: every room takes
  // the room from one left edge (--page-max 100%), Today with no width of its own, and Today's sections (Needs you,
  // the packs' blocks, More for today once open) balance into columns through the shared Balance.
  const compose = read('src/renderer/src/styles/compose.css');
  assert.ok(/:root\s*\{[^}]*--page-max:\s*100%/s.test(compose), 'the rooms take the room');
  assert.ok(/\.td-inner\.td-inner,[^{]*\{[^}]*max-width:\s*none/s.test(compose), 'Today keeps no width of its own');
  const today = read('src/renderer/src/views/TodayView.tsx');
  assert.ok(today.includes('<Balance') && today.includes('...(elseOpen ? moreForToday : [])'), 'More for today balances its sections with the rest once open');
});

// ── Live: a vault as busy as a real one ──────────────────────────────────────────
// Made-up shops and homes, dated from today so every run counts the same shape: 14 projects across six areas
// (Family and Library hold nothing), one of them a hub with 100 tick boxes across linked notes, 3 bills,
// 4 systems, meetings, and site notes that would offer the Sites pack.

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const day = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return iso(d);
};

const AREAS_JSON = {
  version: 1,
  home: 'work',
  areas: [
    { id: 'work', name: 'Work', folder: 'Work', icon: 'briefcase', color: 'slate', about: 'Your job' },
    { id: 'business', name: 'Business', folder: 'Business', icon: 'chart', color: 'clay', about: 'A business of your own' },
    { id: 'home', name: 'Home', folder: 'Home', icon: 'home', color: 'ochre', about: 'The house' },
    { id: 'family', name: 'Family', folder: 'Family', icon: 'people', color: 'rose', about: 'Partner and kids' },
    { id: 'health', name: 'Health', folder: 'Health', icon: 'heart', color: 'sage', about: 'Fitness and food' },
    { id: 'me', name: 'Me', folder: 'Me', icon: 'person', color: 'sky', about: 'Your career' },
    { id: 'publications', name: 'Publications', folder: 'Publications', icon: 'book', color: 'plum', about: 'What you publish' },
    { id: 'library', name: 'Library', folder: 'Library', icon: 'bookmark', color: 'stone', about: 'Templates and references', quiet: true },
  ],
};

function busyVault(h) {
  const w = (rel, text) => {
    const p = path.join(h.vaultDir, ...rel.split('/'));
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, text);
  };
  const proj = (name, { health = 'on track', steps = [], dates = '', updated = '' } = {}) => {
    const lines = steps.map(([what, who, off]) => `- [ ] ${what} — ${who} · by ${day(off)}`);
    return `---\ntype: project\nstatus: active\nhealth: ${health}\nowner: Alex Chen${updated ? `\nupdated: ${updated}` : ''}\n---\n# ${name}\n\n## What’s next\n\n${lines.join('\n')}\n${dates}\n`;
  };
  const datesTable = (rows) => `## Key dates\n\n| When | What | Status |\n| --- | --- | --- |\n${rows.map(([off, what, status]) => `| ${day(off)} | ${what} | ${status} |`).join('\n')}\n`;
  // Six areas hold projects; Family and Library hold nothing (no folder, nothing in them).
  w('Work/Projects/Bakery Launch/Bakery Launch.md', proj('Bakery Launch', { steps: [['Order the flour', 'Alex Chen', -1], ['Ring the landlord', 'Alex', 0], ['Fit out the ovens', 'Priya Nair', 2]] }));
  w('Work/Projects/IT Shop/IT Shop.md', proj('IT Shop', { steps: [['Patch the server', 'Alex Chen', 0], ['Rack the switch', 'me', 9]] }));
  w('Work/Projects/Studio Upgrade/Studio Upgrade.md', proj('Studio Upgrade', { health: 'at risk', steps: [['Send the reconciliation', 'Alex Chen', -2], ['Chase the spare microphone stands', 'Priya Nair', -3]] }));
  w('Work/Projects/Harbour Fit-out/Harbour Fit-out.md', proj('Harbour Fit-out', { steps: [['Approve the lighting quote', 'Alex Chen', 4]] }));
  w('Work/Projects/Desk Hub/Desk Hub.md', `---\ntype: project\nstatus: active\nhealth: on track\nowner: Alex Chen\n---\n# Desk Hub\n\nThe hub everything links to. Its own work is small; the hundred boxes live in linked notes.\n\n${datesTable([[-3, 'Racking lands', 'planned']])}\n`);
  w('Work/Projects/Museum Roster/Museum Roster.md', proj('Museum Roster', { steps: [['Fill the Friday nights', 'Alex Chen', 1], ['Confirm the volunteers', 'Priya Nair', 3]] }));
  w('Business/Projects/Cart Fix/Cart Fix.md', proj('Cart Fix', { steps: [['Fix the retry', 'Alex Chen', -1], ['Send receipts v2', 'Alex Chen', 2]] }));
  w('Business/Projects/Receipts v2/Receipts v2.md', proj('Receipts v2', { steps: [['Review the proof', 'Alex Chen', 0]] }));
  w('Business/Projects/North Sydney Kiosk/North Sydney Kiosk.md', proj('North Sydney Kiosk', { steps: [['Sign the lease', 'Alex Chen', 5]] }));
  w('Home/Projects/Harbour Kitchen/Harbour Kitchen.md', proj('Harbour Kitchen', { updated: day(-20), steps: [['Choose the splashback', 'Alex Chen', 6]] }));
  w('Home/Projects/Harbour Kitchen/Notes/Catchup.md', `# Catchup\n\nFrom the walk-through with the builder.\n\n- [ ] Order the splashback tiles\n- [ ] Book the tiler for next month\n`);
  w('Home/Projects/Garage Lab/Garage Lab.md', proj('Garage Lab', { steps: [['Mount the shelf', 'Alex Chen', 0]] }));
  w('Health/Projects/Physio Plan/Physio Plan.md', proj('Physio Plan', { steps: [['Book the review', 'Alex Chen', 3]] }));
  w('Me/Projects/CV Refresh/CV Refresh.md', proj('CV Refresh', { steps: [['Rewrite the summary', 'Alex Chen', 1]] }));
  w('Publications/Projects/Spring Newsletter/Spring Newsletter.md', proj('Spring Newsletter', { steps: [['Draft the opening', 'Alex Chen', 4]] }));
  // A hundred tick boxes across ten notes that link to the hub (bare links: no project property, not in its
  // folder, not named in its file). None is the hub's own: none waits on it.
  for (let n = 1; n <= 10; n++) {
    const boxes = Array.from({ length: 10 }, (_, i) => `- [ ] Hub job ${n}-${i + 1}`).join('\n');
    w(`Notes/Hub Log ${n}.md`, `# Hub Log ${n}\n\nNotes for [[Desk Hub]].\n\n${boxes}\n`);
  }
  // Three bills, four systems, two meetings, and site notes that would offer the Sites pack.
  const bill = (name, due, amount, extra = '') => `---\ntype: bill\namount: '${amount}'\ncycle: Monthly\ndue: ${due}\ncategory: Phone and internet\n${extra}---\n## Price history\n\n| Date | Amount | Note |\n| --- | --- | --- |\n\n## Notes\n`;
  w('Me/Finance/Bills/Harbour Internet.md', bill('Harbour Internet', day(-1), '189.00'));
  w('Me/Finance/Bills/Power Bill.md', bill('Power Bill', day(2), '214.50'));
  w('Me/Finance/Bills/Council Rates.md', bill('Council Rates', day(5), '486.00', 'autopay: Yes\n'));
  w(
    'Home/Systems and Home Lab/Machines.md',
    `---\ntype: systems-table\ntable: machines\nversion: 1\n---\n# Machines\n\nOne line per machine. You can read this file; the Systems page reads it too.\n\n| Name | Kind | Role | System | Address | Where it is | Status | Last checked | Logins | Note file |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n| Fileshare | Server | Files and backups | Ubuntu 24.04.1 LTS |  | Garage rack | Up |  |  |  |\n| Mediabox | Server | Media | Ubuntu 24.04.1 LTS |  | Garage rack | Up |  |  |  |\n| Plover | Workstation | Daily driver | Ubuntu 24.04.1 LTS |  | Study desk | Up |  |  |  |\n| Juniper | Server | Test box | Ubuntu 24.04.1 LTS |  | Garage rack | Up |  |  |  |\n`,
  );
  // Meetings upcoming, not today: the calm screen fits at every pictured size, and the prep rows still list.
  w('Meetings/Supplier call.md', `---\ntype: meeting\ndate: ${day(1)}\nattendees: [Alex Chen, Priya Nair]\n---\n# Supplier call\n\n## Agenda\n\n- Flour order\n\n## Actions\n\n- [ ] Bring the tile samples — Alex Chen\n`);
  w('Notes/Patch panel map.md', `# Patch panel map\n\nThe patch panel and switch port map for the server room, with each asset tag.\n`);
  w('Notes/Printer warranty.md', `# Printer warranty\n\nThe warranty runs out in March; the serial number is on the back.\n`);
  w('.neuralvault/areas.json', JSON.stringify(AREAS_JSON, null, '\t'));
}

let H = null;
async function harness() {
  if (!H) {
    const { startHarness } = await import('./vault-controls-harness.mjs');
    H = await startHarness({ realChecks: true });
    busyVault(H);
    await H.services.rescanAll();
    await H.services.invoke('settings:update', [{ prefs: { modules: { finance: { on: true }, systems: { on: true }, meetings: { on: true } } } }]);
    await H.services.invoke('state:save', ['home-cards', { on: ['due', 'recent', 'upcoming', 'brief', 'inbox'] }]);
    await H.browser.send('Page.navigate', { url: `${H.origin}/harness.html` });
    await waitFor(H, `!!document.querySelector('.app')`);
    await sleep(2500);
  }
  return H;
}
after(async () => {
  if (H) await H.close().catch(() => undefined);
  H = null;
});

async function waitFor(h, js, ms = 25000) {
  const t0 = Date.now();
  for (;;) {
    try {
      if (await h.browser.ev(js)) return;
    } catch {}
    if (Date.now() - t0 > ms) throw new Error(`waited: ${js.slice(0, 140)}`);
    await sleep(300);
  }
}

async function clickWords(h, words, scope = '') {
  const r = await h.browser.ev(`(async () => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
    const root = ${scope ? `document.querySelector(${JSON.stringify(scope)})` : 'document'};
    if (!root) return 'NOROOT';
    const els = [...root.querySelectorAll('button, a[href], [role="button"], [role="tab"]')].filter(vis);
    const el = els.find((e) => ((e.innerText || e.getAttribute('aria-label') || e.title || '').replace(/\\s+/g, ' ').includes(${JSON.stringify(words)})));
    if (!el) return 'NOTFOUND';
    el.scrollIntoView({ block: 'nearest' });
    el.click();
    await new Promise((r) => setTimeout(r, 400));
    return 'CLICKED';
  })()`);
  assert.equal(r, 'CLICKED', `clicked ${words}${scope ? ` under ${scope}` : ''}`);
}

async function shot(h, W, Hg, file, scrollTo = '') {
  await h.browser.send('Emulation.setDeviceMetricsOverride', { width: W, height: Hg, deviceScaleFactor: 2, mobile: false });
  await sleep(900);
  if (scrollTo) {
    await h.browser.ev(`document.querySelector(${JSON.stringify(scrollTo)})?.scrollIntoView()`);
    await sleep(400);
  }
  const d = await h.browser.send('Page.captureScreenshot', { format: 'png' });
  assert.ok(d.result?.data, `pixels for ${file}`);
  writeFileSync(path.join(shotsDir, file), Buffer.from(d.result.data, 'base64'));
}

/** The list's kinds as Needs you counts them: sections and marked rows, expansions once. Since layout round 2 and
 *  2.0.1 the rows stand in three lists (Needs you, the packs' due block, the cards block), so every list counts. */
const ROWS_JS = `[...document.querySelectorAll('.td-look-items')].reduce((n, list) => n + list.querySelectorAll(':scope section[data-section]:not(details section), :scope [data-look-row]:not(section):not(details [data-look-row])').length, 0)`;

// Layout rounds 2 and 3 (20 Nov 2026) re-laid the calm screen: Needs you stands on it with its rows and its count, the
// packs' due and cards blocks beside it, and the rest of the day (waiting, risk, activity) folds behind one quiet
// "More for today" head that stands open in three columns at a wide window and is remembered narrower. The walks
// below check that shape (updated 23 Nov 2026); what they protect is the same: one calm screen, every former block
// a counted row that opens as before, nothing else standing on it.
test('shut: one calm screen at 3456, 1920 and 1219, pictured', { timeout: 420000 }, async () => {
  const h = await harness();
  const ev = h.browser.ev;
  await h.browser.send('Emulation.setDeviceMetricsOverride', { width: 3456, height: 1408, deviceScaleFactor: 1, mobile: false });
  await clickWords(h, 'Today');
  await waitFor(h, `!!document.querySelector('.td-view')`);
  await waitFor(h, `!!document.querySelector('[data-section="also"]')`);
  await sleep(2500);
  // What stays, top to bottom: the date and greeting, one plain line, Late, Next, meetings, Needs you, More for today.
  assert.ok(await ev(`!!document.querySelector('.td-view .td-date')`), 'the date');
  assert.ok(await ev(`(document.querySelector('.td-view h1')?.innerText ?? '').length > 0`), 'the greeting');
  assert.ok(await ev(`!!document.querySelector('.td-view .td-sentence')`), 'one plain line of what matters');
  assert.ok(await ev(`!!document.querySelector('[data-section="late"]')`), 'Late answers first');
  assert.equal(await ev(`document.querySelectorAll('[data-section="next"] .td-row').length`), 5, 'Next (5)');
  assert.ok(await ev(`!!document.querySelector('[data-section="meetings"]')`), 'today’s meetings, with Record beside them');
  assert.ok(await ev(`[...document.querySelectorAll('[data-section="meetings"] button')].some((b) => (b.innerText || '').includes('Record a meeting'))`), 'Record beside them');
  const head = await ev(`document.querySelector('[data-section="also"] h2')?.innerText.replace(/\\s+/g, ' ').trim() ?? ''`);
  assert.equal(head, 'More for today', 'one quiet head for the rest of the day');
  // Needs you counts what it shows: its number is the rows across its lists, and a busy vault folds into a few.
  const needs = await ev(`document.querySelector('[data-section="needs"] h2')?.innerText.replace(/\\s+/g, ' ') ?? ''`);
  const m = /Needs you (\d+)/.exec(needs);
  assert.ok(m, `one Needs you head counts its rows (saw ${JSON.stringify(needs)})`);
  const n = Number(m[1]);
  assert.equal(await ev(ROWS_JS), n, `Needs you's number is its rows (${n})`);
  assert.ok(n >= 5, `a busy vault folds several rows into Needs you (saw ${n})`);
  // Nothing else stands on the calm screen: no offers, no card chooser, no folder nag, no box count.
  const shut = await ev(`document.querySelector('.td-view')?.innerText.replace(/\\s+/g, ' ') ?? ''`);
  for (const gone of ['Switch on', 'could help', 'Your cards', 'Change cards', 'Move this folder', '101 waiting', '100 waiting', 'Recently viewed']) {
    assert.ok(!shut.includes(gone), `no ${gone} on the calm screen`);
  }
  // Area chips show only areas with notes: Family and Library hold nothing, so they chip nothing.
  const chips = await ev(`[...document.querySelectorAll('.td-areas button')].map((b) => b.innerText.replace(/\\s+/g, ' ').trim())`);
  assert.ok(chips.includes('All areas') && chips.includes('Work'), `kept chips show: ${JSON.stringify(chips)}`);
  assert.ok(!chips.includes('Family') && !chips.includes('Library'), `empty areas chip nothing: ${JSON.stringify(chips)}`);
  // At 3456 wide More for today's head, the last head on the calm screen, shows at a glance; Today keeps no
  // width of its own at any size (compose.css: it takes the room like every room).
  for (const [W, Hg, file] of [[3456, 1408, '03-after-3456.png'], [1920, 1117, '04-after-1920.png'], [1219, 709, '05-after-1219.png']]) {
    await h.browser.send('Emulation.setDeviceMetricsOverride', { width: W, height: Hg, deviceScaleFactor: 1, mobile: false });
    await sleep(900);
    const fit = await ev(`(() => { const l = document.querySelector('[data-section="also"] h2'); return { lineBottom: l.getBoundingClientRect().bottom, innerH: window.innerHeight, max: getComputedStyle(document.querySelector('.td-inner')).maxWidth }; })()`);
    if (W >= 3456) assert.ok(fit.lineBottom <= fit.innerH, `at ${W}px More for today shows at a glance (bottom ${Math.round(fit.lineBottom)} of ${fit.innerH})`);
    assert.equal(fit.max, 'none', `at ${W}px Today keeps no width of its own`);
    await shot(h, W, Hg, file);
  }
});

test('open: every former block is a row, honestly counted, opening as now', { timeout: 420000 }, async () => {
  const h = await harness();
  const ev = h.browser.ev;
  // At 1920 More for today is shut until opened, and remembered (at 3456 it stands open in its own column).
  await h.browser.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1117, deviceScaleFactor: 1, mobile: false });
  await sleep(700);
  if ((await ev(`document.querySelector('[data-section="also"] .td-more')?.getAttribute('aria-expanded')`)) !== 'true') await clickWords(h, 'Show', '[data-section="also"]');
  await sleep(1200);
  assert.equal(await ev(`document.querySelector('[data-section="also"] .td-more')?.getAttribute('aria-expanded')`), 'true', 'More for today opens');
  const line = await ev(`document.querySelector('[data-section="also"] .td-more')?.innerText.replace(/\\s+/g, ' ') ?? ''`);
  assert.match(line, /Show fewer/, 'open, it says Show fewer');
  assert.ok(await ev(`!!document.querySelector('[data-section="waiting"]')`), 'the work sections show once open');
  // The hundred linked boxes wait on nothing: the hub reads its one slipped date, never the boxes.
  // The projects fold into one row (8 Nov 2026 calm list): open it to read them.
  await ev(`[...document.querySelectorAll('.td-look-items .td-look-row > summary')].find((e) => e.innerText.includes('projects have notes waiting'))?.click()`);
  await sleep(600);
  const projects = await ev(`[...( [...document.querySelectorAll('.td-look-items .td-look-row')].find((e) => e.innerText.includes('projects have notes waiting'))?.querySelectorAll('.rm-today-row') ?? [])].map((li) => li.innerText.replace(/\\s+/g, ' ').trim())`);
  const hub = projects.find((t) => t.startsWith('Desk Hub')) ?? '';
  assert.match(hub, /1 needs a look\./, `the hub reads its slipped date: ${JSON.stringify(hub)}`);
  assert.ok(!/10\d waiting/.test(projects.join(' | ')), `no box count anywhere: ${JSON.stringify(projects).slice(0, 200)}`);
  const kitchen = projects.find((t) => t.startsWith('Harbour Kitchen')) ?? '';
  assert.match(kitchen, /2 waiting from your notes/, `its own note's open tasks still wait: ${JSON.stringify(kitchen)}`);
  // The packs' items list as rows: bills due, systems at risk. (Meetings to prep left these lists for the one
  // Meetings card in 2.0.1; this vault's one meeting is tomorrow.)
  assert.equal(await ev(`document.querySelectorAll('.td-look-items [data-section="bills"] .rm-today-row').length`), 3, 'three bills due');
  assert.equal(await ev(`document.querySelectorAll('.td-look-items [data-section="systems"] .rm-today-row').length`), 4, 'four systems at risk');
  // A turned-on card is a row; empty Recently viewed is none.
  const rows = await ev(`[...document.querySelectorAll('.td-look-items .td-look-row > summary')].map((e) => e.innerText.replace(/\\s+/g, ' ').trim())`);
  assert.ok(rows.includes('Inbox'), `the Inbox is a row: ${JSON.stringify(rows)}`);
  assert.ok(!rows.includes('Recently viewed'), 'empty Recently viewed is no row');
  // The count still matches what opening shows, and the rows open as now.
  const n = await ev(ROWS_JS);
  assert.ok(n >= 5 && n <= 8, `the full list holds its kinds (saw ${n})`);
  await ev(`document.querySelector('.td-look-items [data-section="bills"] .rm-today-main')?.click()`);
  // Bills open as pages (bills-as-one-list, kept by t239's click-opens-the-document): the row leaves Today
  // for its bill page, and Today returns with the list still open.
  await waitFor(h, `!document.querySelector('.td-view')`, 8000);
  await waitFor(h, `/Harbour Internet|Power Bill|Council Rates/.test(document.querySelector('main')?.innerText ?? '')`, 8000);
  const bill = await ev(`document.querySelector('main')?.innerText.replace(/\\s+/g, ' ') ?? ''`);
  assert.match(bill, /Harbour Internet|Power Bill|Council Rates/, `the bill page names its bill (${bill.slice(0, 80)})`);
  await clickWords(h, 'Today');
  await waitFor(h, `!!document.querySelector('.td-view')`, 8000);
  await sleep(500);
  await ev(`[...document.querySelectorAll('.td-look-items .td-look-row > summary')].find((e) => e.innerText.includes('projects have notes waiting'))?.click()`);
  await sleep(600);
  await ev(`[...( [...document.querySelectorAll('.td-look-items .td-look-row')].find((e) => e.innerText.includes('projects have notes waiting'))?.querySelectorAll('.rm-today-row') ?? [])].find((li) => li.innerText.includes('Desk Hub'))?.querySelector('button.button.small')?.click()`);
  await waitFor(h, `!!document.querySelector('.pj-page')`, 8000);
  await clickWords(h, 'Today');
  await waitFor(h, `!!document.querySelector('.td-view')`);
  await sleep(1500);
  assert.equal(await ev(`document.querySelector('[data-section="also"] .td-more')?.getAttribute('aria-expanded')`), 'true', 'More for today stays open, as remembered');
  await shot(h, 3456, 1408, '06-after-open-3456.png');
  await shot(h, 1219, 709, '07-after-open-1219.png', '[data-section="systems"]');
});

test('pack offers live in Settings › Packs, never on Today', { timeout: 420000 }, async () => {
  const h = await harness();
  const ev = h.browser.ev;
  await h.browser.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1117, deviceScaleFactor: 1, mobile: false });
  await sleep(700);
  // Settings lives in the account menu (the chip at the sidebar's foot), not as a sidebar row.
  await (await import('./vault-controls-harness.mjs')).openSettings(h);
  await waitFor(h, `!!document.querySelector('.settings-nav')`);
  await clickWords(h, 'Packs', '.settings-nav');
  await waitFor(h, `!!document.querySelector('.ms-list')`);
  await sleep(1500);
  // Sites is off and the vault talks about patch panels and warranties: its row says why.
  const why = await ev(`document.querySelector('section[data-setting="Sites"] .ms-offer')?.innerText.replace(/\\s+/g, ' ').trim() ?? ''`);
  assert.match(why, /notes are about/, `Sites says why (${JSON.stringify(why)})`);
  assert.equal(await ev(`document.querySelector('section[data-setting="Sites"] input')?.checked ?? null`), false, 'Sites stays off until taken');
  // Hide suggestion puts it away, where it never nags again.
  await ev(`document.querySelector('section[data-setting="Sites"] .packrow-words')?.click()`);
  await sleep(500);
  await clickWords(h, 'Hide suggestion', 'section[data-setting="Sites"]');
  await sleep(500);
  assert.equal(await ev(`document.querySelector('section[data-setting="Sites"] .ms-offer')`), null, 'Hide suggestion puts the offer away');
});
