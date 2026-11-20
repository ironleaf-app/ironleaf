// node --test tests/look-list-calm.test.mjs — "Things need a look": fewer, clearer rows (8 Nov 2026).
// Tonight Today became one calm screen with "N things need a look" opening a list; on the vault the line
// says 22. Too many for a calm day. So: rows that say the same thing to different targets fold into one
// row (systems updates, projects waiting, meetings with open actions); rows not for today drop out (tidy
// moves to the weekly review, "only on this PC" shows weekly); the count is one number per kind (about 6
// to 8, not 22); due today first, then waiting, then upkeep. Source checks plus the live harness: a
// made-up made-up vault of realistic size (14 projects, 12 with notes waiting, 4 machines, 3 bills, 3 meetings,
// an edition due), pictured shut and open at 3456x1408, 1920x1117 and 1219x709 in ../shots/.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shotsDir = path.join(root, '..', 'shots');

// ── Shared words (unit, through the bundler like project-checks.test.mjs) ────

let S = null;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const work = path.join(tmpdir(), `nv-look-${process.pid}`);
  mkdirSync(work, { recursive: true });
  const entry = path.join(work, 'shared.ts');
  writeFileSync(entry, ['words', 'project-checks', 'meeting-after'].map((m) => `export * as ${m.replace(/-(\w)/g, (_, c) => c.toUpperCase())} from ${JSON.stringify(path.join(root, 'src/shared', `${m}.ts`))};`).join('\n'));
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 's.mjs'), format: 'esm' }, logLevel: 'silent' });
  S = await import(pathToFileURL(path.join(work, 's.mjs')).href);
});

test('folded words: projects waiting, joined names, meetings with open actions', () => {
  assert.equal(S.projectChecks.projectsWaitingWords(12), '12 projects have notes waiting');
  assert.equal(S.projectChecks.projectsWaitingWords(1), '1 project has notes waiting');
  assert.equal(S.words.joinNames(['Fileshare']), 'Fileshare');
  assert.equal(S.words.joinNames(['Fileshare', 'Mediabox']), 'Fileshare and Mediabox');
  assert.equal(S.words.joinNames(['Fileshare', 'Mediabox', 'Plover', 'Juniper']), 'Fileshare, Mediabox, Plover and Juniper');
  assert.equal(S.meetingAfter.afterflowFoldWords(3), '3 meetings finished with actions still open');
  assert.equal(S.meetingAfter.afterflowFoldWords(1), '1 meeting finished with actions still open');
});

// ── "Only on this PC" shows weekly, not daily ────────────────────────────────

test('the only-here tip snoozes a week after Not now, then shows again', async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const work = path.join(tmpdir(), `nv-look-place-${process.pid}`);
  mkdirSync(work, { recursive: true });
  const entry = path.join(work, 'place.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/main/vault-place.ts'))};`);
  await build({ input: entry, platform: 'node', external: ['electron'], output: { file: path.join(work, 'p.mjs'), format: 'esm' }, logLevel: 'silent' });
  const P = await import(pathToFileURL(path.join(work, 'p.mjs')).href);
  const base = { place: { kind: 'local' }, counts: { notes: 50, projects: 3 }, found: null };
  const now = new Date(2026, 10, 8, 19, 0);
  // Never put away: it shows.
  assert.equal(P.vaultCards({ ...base, tipSnoozedAt: null, now }).onlyHereCard, true);
  // Put away yesterday: it waits.
  assert.equal(P.vaultCards({ ...base, tipSnoozedAt: new Date(2026, 10, 7, 19, 0).toISOString(), now }).onlyHereCard, false);
  // Put away eight days ago: a week has passed, it shows again.
  assert.equal(P.vaultCards({ ...base, tipSnoozedAt: new Date(2026, 9, 31, 19, 0).toISOString(), now }).onlyHereCard, true);
  // A synced vault never shows it, snoozed or not.
  assert.equal(P.vaultCards({ ...base, place: { kind: 'synced' }, tipSnoozedAt: null, now }).onlyHereCard, false);
});

// ── Folding: one row per repeated thing ──────────────────────────────────────

test('projects waiting fold into one row opening the list', () => {
  const src = read('src/renderer/src/views/today/ProjectChecksToday.tsx');
  assert.ok(src.includes('<LookRow'), 'one row through LookRow');
  assert.ok(src.includes('projectsWaitingWords('), 'worded by the shared helper');
  assert.ok(!src.includes('data-section="project-checks"'), 'no section of its own any more: the row counts once');
});

test('security updates fold into one row naming every machine, opening Systems', () => {
  const src = read('src/renderer/src/views/modules/life/SystemsPage.tsx');
  assert.ok(src.includes('joinNames('), 'the machines join into one row');
  assert.ok(src.includes('Security updates have waited over a week on'), 'the row keeps the alerts’ words');
  assert.ok(src.includes("openModule('systems')"), 'opening Systems');
});

test('meetings with open actions fold into one row', () => {
  const src = read('src/renderer/src/views/modules/work/MeetingsPage.tsx');
  assert.ok(src.includes('afterflowFoldWords('), 'one row for the finished meetings');
  // t238: no carry row any more — a meeting's actions are its project's tasks already, nothing to carry.
  assert.ok(!src.includes('to carry into projects'), 'the carry row is gone');
});

// ── The count is one number per kind ─────────────────────────────────────────

test('the line counts kinds: sections and marked rows, never one per item', () => {
  const src = read('src/renderer/src/views/TodayView.tsx');
  assert.ok(src.includes('section[data-section]'), 'each section counts once');
  assert.ok(!src.includes('li:not(details li)'), 'never one per item any more');
  assert.ok(src.includes('[data-look-row]'), 'marked rows still count once');
  // Every module's Today section carries the mark, so every pack counts once.
  for (const f of ['src/renderer/src/views/modules/HealthToday.tsx', 'src/renderer/src/views/modules/FamilyToday.tsx', 'src/renderer/src/views/modules/PublicationsToday.tsx']) {
    assert.ok(read(f).includes('data-section='), `${f} marks its section`);
  }
});

// ── Order and what leaves Today ──────────────────────────────────────────────

test('due today first, then waiting, then upkeep', () => {
  const src = read('src/renderer/src/views/TodayView.tsx');
  const at = (mark) => {
    const i = src.indexOf(mark);
    assert.ok(i >= 0, `${mark} lists with the rows`);
    return i;
  };
  const due = at('<TodayModules group="due"');
  const waiting = at('<TodayModules group="waiting"');
  const notes = at('<ProjectChecksToday />');
  const upkeep = at('<TodayModules group="upkeep"');
  const dormant = at('{isToday && dormantQuiet}');
  const review = at('{isToday && reviewQuiet}');
  assert.ok(due < waiting && waiting < notes && notes < upkeep && upkeep < dormant && dormant < review, 'bills and editions, meetings and notes, systems, loose ends, review');
});

test('tidy leaves Today for the weekly review, reachable there', () => {
  const today = read('src/renderer/src/views/TodayView.tsx');
  assert.ok(!today.includes('tidyQuiet'), 'no tidy row on Today any more');
  const review = read('src/renderer/src/views/WeeklyReview.tsx');
  assert.ok(review.includes('ready to tidy'), 'the weekly review carries it');
  assert.ok(review.includes('TidyAllDialog') || review.includes('openTidy'), 'one click from there');
});

// ── Live: a made-up vault of realistic size ─────────────────────────────────────────
// 14 projects (12 with notes waiting), 4 machines with updates waiting, 3 bills, 3 finished
// meetings with open actions, an edition due, 3 dormant projects with loose ends, tidy waiting, and
// the review due. Made-up shops and homes; the machines keep today-calm's names so the folded row
// reads exactly as theirs does.

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
    { id: 'health', name: 'Health', folder: 'Health', icon: 'heart', color: 'sage', about: 'Fitness and food' },
    { id: 'me', name: 'Me', folder: 'Me', icon: 'person', color: 'sky', about: 'Your career' },
    { id: 'publications', name: 'Publications', folder: 'Publications', icon: 'book', color: 'plum', about: 'What you publish' },
  ],
};

function ownerShapedVault(h) {
  const w = (rel, text) => {
    const p = path.join(h.vaultDir, ...rel.split('/'));
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, text);
  };
  const proj = (name, { steps = [], dates = '', extra = '' } = {}) => {
    const lines = steps.map(([what, who, off]) => `- [ ] ${what} — ${who} · by ${day(off)}`);
    return `---\ntype: project\nstatus: active\nhealth: on track\nowner: Alex Chen\n---\n# ${name}\n\n## What’s next\n\n${lines.join('\n')}\n${dates}\n${extra}\n`;
  };
  const slipped = (what) => `## Key dates\n\n| When | What | Status |\n| --- | --- | --- |\n| ${day(-3)} | ${what} | planned |\n`;
  // Twelve live projects each with a slipped date (a standing check, so each waits); two clean.
  const names = ['Bakery Launch', 'IT Shop', 'Studio Upgrade', 'Harbour Fit-out', 'Museum Roster', 'Cart Fix', 'Receipts v2', 'North Sydney Kiosk', 'Harbour Kitchen', 'Garage Lab', 'Physio Plan', 'CV Refresh'];
  names.forEach((n, i) => {
    const area = i < 5 ? 'Work' : i < 8 ? 'Business' : i < 10 ? 'Home' : i < 11 ? 'Health' : 'Me';
    w(`${area}/Projects/${n}/${n}.md`, proj(n, { steps: [[`Ring about ${n}`, 'Alex Chen', 2]], dates: slipped(`${n} lands`) }));
  });
  w('Work/Projects/Quiet Shed/Quiet Shed.md', proj('Quiet Shed', { steps: [['Sweep the floor', 'Alex Chen', 4]] }));
  w('Me/Projects/Slow Read/Slow Read.md', proj('Slow Read', { steps: [['Read a chapter', 'Alex Chen', 6]] }));
  // Three finished projects still holding a loose end each.
  for (const n of ['Corner Store', 'Night Stall', 'Old Van']) {
    w(`Work/Projects/${n}/${n}.md`, `---\ntype: project\nstatus: finished\nhealth: on track\nowner: Alex Chen\n---\n# ${n}\n\n## What’s next\n\n- [ ] File the last receipt — Alex Chen · by ${day(1)}\n`);
  }
  // Tidy waiting: done steps older than a fortnight (by the file's own updated day).
  for (const n of ['Bakery Launch', 'IT Shop']) {
    const p = path.join(h.vaultDir, 'Work/Projects', n, `${n}.md`);
    const text = readFileSync(p, 'utf8').replace('owner: Alex Chen\n', `owner: Alex Chen\nupdated: ${day(-20)}\n`).replace('## What’s next\n\n', `## What’s next\n\n- [x] Ordered the first trays\n`);
    writeFileSync(p, text);
  }
  // Three bills due.
  const bill = (due, amount, extra = '') => `---\ntype: bill\namount: '${amount}'\ncycle: Monthly\ndue: ${due}\ncategory: Phone and internet\n${extra}---\n## Price history\n\n| Date | Amount | Note |\n| --- | --- | --- |\n\n## Notes\n`;
  w('Me/Finance/Bills/Harbour Internet.md', bill(day(-1), '189.00'));
  w('Me/Finance/Bills/Power Bill.md', bill(day(2), '214.50'));
  w('Me/Finance/Bills/Council Rates.md', bill(day(5), '486.00', 'autopay: Yes\n'));
  // Four machines with security updates waiting over a week (checked then and still waiting).
  for (const [name, kind] of [['Fileshare', 'Server'], ['Mediabox', 'Server'], ['Plover', 'Workstation'], ['Juniper', 'Server']]) {
    w(`Home/Systems and Home Lab/Machines/${name}.md`, `---\ntype: machine\nkind: ${kind}\nstatus: Up\n---\n## Health log\n\n| Date | Status | Note |\n| --- | --- | --- |\n| ${day(-9)} | Up | Checked: Ubuntu 24.04 LTS, disk 41% used, 4 security updates waiting. |\n| ${day(0)} | Up | Checked: Ubuntu 24.04 LTS, disk 42% used, 4 security updates waiting. |\n\n## Notes\n\n`);
  }
  // Three finished meetings with actions still open (unfiled, so they also wait to carry).
  const meet = (title, off, actions) => `---\ntype: meeting\ndate: ${day(off)}\nattendees: [Alex Chen, Priya Nair]\n---\n# ${title}\n\n## Actions\n\n${actions.map((a) => `- [ ] ${a} — Alex Chen`).join('\n')}\n`;
  w('Meetings/Supplier review.md', meet('Supplier review', -2, ['Send the flour quote', 'Book the delivery slot']));
  w('Meetings/Roster talk.md', meet('Roster talk', -4, ['Confirm the Friday volunteers']));
  w('Meetings/Lease call.md', meet('Lease call', -6, ['Ask about the bond', 'Measure the back room']));
  // A publication whose edition is due within two days, with no edition yet.
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const morrow = days[(new Date().getDay() + 1) % 7];
  w('Publications/The Harbour Gazette.md', `---\ntype: publication\nmasthead: The Harbour Gazette\nschedule: ${morrow} 07:00\n---\n# The Harbour Gazette\n\nThe street's own paper.\n`);
  w('Notes/Patch panel map.md', `# Patch panel map\n\nThe patch panel and switch port map for the server room.\n`);
  w('.neuralvault/areas.json', JSON.stringify(AREAS_JSON, null, '\t'));
}

let H = null;
async function harness() {
  if (!H) {
    const { startHarness } = await import('./vault-controls-harness.mjs');
    H = await startHarness({ realChecks: true });
    // The harness seeds a base vault (its own projects and a standup); wipe it so the
    // owner-shaped vault below is exactly what Today reads (12 waiting, 3 meetings).
    const { rmSync, readdirSync } = await import('node:fs');
    for (const e of readdirSync(H.vaultDir)) rmSync(path.join(H.vaultDir, e), { recursive: true, force: true });
    ownerShapedVault(H);
    await H.services.rescanAll();
    const now = new Date();
    await H.services.invoke('settings:update', [{ prefs: { modules: { finance: { on: true }, systems: { on: true }, meetings: { on: true }, publications: { on: true } }, weeklyReview: true, weeklyReviewDay: now.getDay(), weeklyReviewTime: '00:00' } }]);
    await H.services.invoke('state:save', ['home-cards', { on: [] }]);
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

/** The list's kinds in order, as the quiet line counts them. */
const KINDS_JS = `[...document.querySelector('.td-look-items').querySelectorAll(':scope section[data-section]:not(details section), :scope [data-look-row]:not(section):not(details [data-look-row])')].map((el) => el.getAttribute('data-section') || el.innerText.replace(/\\s+/g, ' ').trim().slice(0, 60))`;

test('a busy vault reads about 6 to 8, folded and ordered, pictured shut and open', { timeout: 420000 }, async () => {
  const h = await harness();
  const ev = h.browser.ev;
  await h.browser.send('Emulation.setDeviceMetricsOverride', { width: 3456, height: 1408, deviceScaleFactor: 1, mobile: false });
  await clickWords(h, 'Today');
  await waitFor(h, `!!document.querySelector('.td-view')`);
  await waitFor(h, `!!document.querySelector('[data-section="also"]')`);
  await sleep(2500);
  const line = await ev(`document.querySelector('[data-section="also"] h2')?.innerText.replace(/\\s+/g, ' ') ?? ''`);
  const m = /Also (\d+)/.exec(line);
  assert.ok(m, `one Also head counts what opening shows (saw ${JSON.stringify(line)})`);
  const n = Number(m[1]);
  const kinds = await ev(KINDS_JS);
  assert.ok(kinds.length >= 6 && kinds.length <= 8, `about 6 to 8 look kinds, not 22 (saw ${kinds.length})`);
  assert.ok(n >= kinds.length, `Also counts the look kinds with the rest of the work (${n} over ${kinds.length})`);
  // Folded: one systems row naming every machine, one projects row, one meetings row.
  const items = await ev(`document.querySelector('.td-look-items')?.innerText.replace(/\\s+/g, ' ') ?? ''`);
  assert.match(items, /Security updates have waited over a week on Fileshare, Mediabox, Plover and Juniper/, 'systems fold into one row');
  assert.match(items, /12 projects have notes waiting/, 'projects fold into one row');
  assert.match(items, /3 meetings finished with actions still open/, 'meetings fold into one row');
  assert.equal(await ev(`document.querySelectorAll('.td-look-items [data-section="bills"] .rm-today-row').length`), 3, 'three bills still list');
  // Not for today: no tidy row, and the tip waits its week once put away.
  assert.ok(!items.includes('ready to tidy'), 'tidy leaves Today');
  // Order: bills and editions first, meetings and notes next, systems and review last.
  const order = await ev(`[...document.querySelector('.td-look-items').querySelectorAll(':scope section[data-section]:not(details section), :scope [data-look-row]:not(section):not(details [data-look-row])')].map((el) => el.getAttribute('data-section') || (el.innerText.includes('projects have notes waiting') ? 'notes' : el.innerText.includes('review') ? 'review' : el.innerText.includes('loose end') ? 'dormant' : el.innerText.includes('only on this PC') ? 'vault' : '?'))`);
  const pos = (k) => order.indexOf(k);
  assert.ok(pos('bills') >= 0 && pos('publications') >= 0 && pos('meetings') >= 0, `due and waiting list: ${JSON.stringify(order)}`);
  assert.ok(pos('bills') < pos('meetings') && pos('publications') < pos('meetings'), `due today first: ${JSON.stringify(order)}`);
  assert.ok(pos('meetings') < pos('notes') && pos('notes') < pos('systems'), `then waiting, then upkeep: ${JSON.stringify(order)}`);
  assert.ok(pos('systems') < pos('dormant') && pos('dormant') < pos('review'), `upkeep ends with the review: ${JSON.stringify(order)}`);
  // Shut at every size, then open: every item one click from its row or its page.
  await shot(h, 3456, 1408, 'look-after-shut-3456.png');
  await shot(h, 1920, 1117, 'look-after-shut-1920.png');
  await shot(h, 1219, 709, 'look-after-shut-1219.png');
  await clickWords(h, 'Show', '[data-section="also"]');
  await sleep(1200);
  assert.ok(await ev(`document.querySelector('.td-look-open')?.hidden === false`), 'Also opens');
  // The folded projects row opens to all twelve, each with its Open.
  await ev(`[...document.querySelectorAll('.td-look-items .td-look-row > summary')].find((e) => e.innerText.includes('projects have notes waiting'))?.click()`);
  await sleep(600);
  assert.equal(await ev(`[...document.querySelectorAll('.td-look-items .td-look-row')].find((e) => e.innerText.includes('projects have notes waiting'))?.querySelectorAll('.rm-today-row').length`), 12, 'all twelve open from the one row');
  await shot(h, 3456, 1408, 'look-after-open-3456.png');
  await shot(h, 1920, 1117, 'look-after-open-1920.png');
  await shot(h, 1219, 709, 'look-after-open-1219.png', '[data-section="systems"]');
  // Tidy lives in the weekly review now (the review's own row opens it).
  await clickWords(h, 'time for the weekly review', '.td-look-items');
  await waitFor(h, `!!document.querySelector('.wr-page')`);
  await sleep(1500);
  const wr = await ev(`document.querySelector('.wr-page')?.innerText.replace(/\\s+/g, ' ') ?? ''`);
  assert.match(wr, /ready to tidy/, 'the weekly review carries the tidy');
});
