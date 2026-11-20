// node --test tests/t12-no-repeats.test.mjs — nothing said twice, nothing empty on show (t12, 8 Nov 2026; 4
// Nov: "everything earns a place"). A project page shows only sections with something in them, with one quiet
// Add line at the foot for the missing ones (Waiting and Activity are derived, so they hide silently and
// appear on their own); a brand-new empty project keeps a short helpful start instead. Nothing reads twice on
// one page: a person's open promises live only under You owe / Owes you (the Timeline keeps meetings, notes
// and finished promises), and a project's dates gone by are marked in Key dates with the top callout counting
// and jumping only.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const tabs = () => read('src/renderer/src/views/project/ProjectTabs87.tsx');
const page = () => read('src/renderer/src/views/ProjectPage.tsx');

// ── 1. Only sections with something in them ────────────────────────────────

test('the folio hides its empty sections: one visibility rule, every section conditional', () => {
  // The one rule lives beside the sections; with tabs (t255) each tab asks it — an empty tab reads its
  // quiet panel, a holding tab its section — so the page still renders each section only while it holds
  // something, and every tab stands, so the order never shifts.
  assert.ok(tabs().includes('export function folioEmptySections'), 'one exported visibility rule beside the sections');
  const p = page();
  assert.ok(p.includes('folioEmptySections('), 'the page asks the rule');
  assert.ok(p.includes('empty.has(t.id as FolioSection)'), 'every tab conditional through the one rule');
  assert.ok(p.includes('<TabEmpty id={t.id as FolioSection}'), 'an empty tab reads its quiet panel, never its section');
  assert.ok(p.includes('PROJECT_TABS.map'), 'every tab stands, so the order never shifts');
  const bodies = p.slice(p.indexOf('const FOLIO_BODY'), p.indexOf('};', p.indexOf('const FOLIO_BODY')));
  for (const id of ['whats-next', 'waiting', 'questions', 'key-dates', 'people', 'decisions', 'notes', 'files', 'risks', 'updates', 'money', 'activity']) {
    assert.ok(bodies.includes(`'${id}':`) || bodies.includes(`${id}: `), `${id} renders only while it holds something`);
  }
});

test('no empty words on show: the sections’ empty states are gone from the folio', () => {
  // wanted nothing empty on show; with tabs (t255) a quiet tab reads one line with its own Add, and the
  // Overview reads one quiet line per empty block instead (t265) — no section carries an empty state.
  const t = tabs();
  for (const words of ['No tasks yet', 'No key dates yet', 'No bills for this project yet', 'No decisions recorded yet', 'Nobody named yet', 'Nobody owes this project anything', 'No notes here yet', 'No files yet', 'No risks named yet', 'Nothing yet', 'Bills are switched off', 'No folder on this PC yet']) {
    assert.ok(!t.includes(words), `no "${words}" left in the folio`);
  }
  // 'No updates yet' reads once: the Overview's Latest-updates block when no update exists (the folio walk
  // proves it live); OverviewSection is the last block in the file, so past its start is inside it.
  assert.equal(t.split('No updates yet').length - 1, 1, 'one quiet updates line left in the folio');
  assert.ok(t.indexOf('No updates yet') > t.indexOf('export function OverviewSection'), 'it is the Overview’s quiet block, not a section’s empty state');
  // The global Tasks page is not the project page: its own empty state stays.
  assert.ok(read('src/renderer/src/views/TasksView.tsx').includes('No tasks yet'), 'Tasks keeps its own empty state');
});

test('every quiet tab carries its own Add, starting its section in one click', () => {
  // t255 moved the foot line into the tabs (t265): each quiet tab reads one line with its own Add, through
  // the same starters — the tabs suite proves the Add answers live.
  const t = tabs();
  for (const [id, noun] of [['whats-next', 'task'], ['waiting', 'waiting step'], ['key-dates', 'key date'], ['people', 'person'], ['decisions', 'decision'], ['notes', 'note'], ['files', 'files'], ['risks', 'risk'], ['updates', 'update'], ['money', 'bill']]) {
    assert.ok(t.includes(`{ id: '${id}', noun: '${noun}'`), `${id} starts straight from its tab (${noun})`);
  }
  const p = page();
  assert.ok(p.includes('function TabEmpty'), 'the quiet panel exists');
  assert.ok(p.includes('data-add={id}'), 'each tab’s Add is its own button');
  assert.ok(p.includes('startSection(id, ctx, edit'), 'it starts its section straight');
  // Questions and Activity are derived or automatic (asked in meetings; recent changes): nothing starts
  // them, so they offer no Add and appear on their own when there is something. Waiting gained its own
  // starter with the tabs (a step for someone else).
  assert.ok(!t.includes("{ id: 'questions'"), 'Questions is derived: no starter');
  assert.ok(!t.includes("{ id: 'activity'"), 'Activity is automatic: no starter');
  assert.ok(p.includes('canEdit && starter'), 'with no starter, no Add reads');
  // Bills off: the Money tab's Add switches on and starts the first bill in one click.
  const start = t.slice(t.indexOf('export function startSection'), t.indexOf('export function startSection') + 1500);
  assert.ok(start.includes('switchBillsOn().then(() => addBill(null'), 'Bills off: switch on and start one');
  // Files merged into Notes and files (t239): the quiet notes tab starts a note, the merged list's head
  // carries Attach for files.
  assert.ok(start.includes("case 'notes': return ctx.noteMenu(anchor)"), 'Notes starts a note from its tab');
  const notesHead = t.slice(t.indexOf('title="Notes and files"'), t.indexOf('title="Notes and files"') + 900);
  assert.ok(notesHead.includes('> Attach<'), 'the merged list carries Attach in its head');
});

test('a brand-new empty project keeps a short helpful start, never a blank page', () => {
  // t255: the start reads on the Overview when every tab holds nothing — the live walk below opens a bare
  // project and proves it.
  const t = tabs();
  assert.ok(t.includes('data-folio-empty'), 'the start exists');
  assert.ok(t.includes('Start this project'), 'it says what it is in plain words');
  const p = page();
  assert.ok(p.includes('FolioEmpty'), 'the page shows it when no section holds anything');
  assert.ok(p.includes("PROJECT_TABS.every((t) => t.id === 'overview'"), 'only when every tab holds nothing');
  assert.ok(p.includes('allEmpty ? <FolioEmpty'), 'the Overview reads it instead of its blocks');
});

test('the tab bar walks every tab, the quiet ones reading quietly', () => {
  // t255: the sticky line is the tab bar (t265) — every tab stands in the folio's order, an empty tab
  // reading quietly instead of hiding, so the order never shifts; the tabs suite walks it live.
  const p = page();
  assert.ok(p.includes('PROJECT_TABS.map'), 'every tab stands in the bar');
  assert.ok(p.includes('<PageTabs tabs={tabs}'), 'the bar is the one shared tablist');
  const bar = read('src/renderer/src/components/PageTabs.tsx');
  assert.ok(bar.includes('role="tablist"') && bar.includes('role="tab"'), 'a real tablist walking the tabs');
  assert.ok(bar.includes('is-quiet'), 'an empty tab reads quietly, never hidden');
});

test('the … menu keeps its entries', () => {
  // Hiding empty sections takes nothing from the … menu: work, report, a new note and the project doors stay.
  const p = page();
  for (const entry of ['New note for this project', 'Tidy this project', 'Export this project']) {
    assert.ok(p.includes(entry), `… keeps ${entry}`);
  }
});

// ── 2a. Dates gone by: marked in Key dates, counted at the top ──────────────

test('Key dates counts the dates gone by up top, never naming them', () => {
  // Step 2: the banner above the sections folded into Key dates, its words kept, each date marked where it sits.
  const t = tabs();
  assert.ok(t.includes('dates went by. Did they happen?'), 'it says how many went by, in plain words');
  assert.ok(t.includes('1 date went by. Did it happen?'), 'one date reads as one');
  assert.ok(!t.includes('hub.toConfirm.slice(0, 2)'), 'it never names the dates (the rows below do that once)');
  assert.ok(!page().includes('1 date went by. Did it happen?'), 'no banner above the sections any more');
});

test('Key dates marks the dates gone by where they sit, with no second list', () => {
  const t = tabs();
  assert.ok(!t.includes('Dates that went by: did they happen?'), 'no second naming inside Key dates');
  assert.ok(t.includes('Went by'), 'a gone-by date is marked where it sits');
  assert.ok(t.includes('wentByDates('), 'one rule names which dates went by');
});

test('Your next keeps one list, not a second date list beside the tasks', () => {
  // Step 2 (their decision 2: one view per list): the Timeline view is gone with its jump; Key dates
  // below names the dates once.
  const t = tabs();
  assert.ok(!t.includes('function TasksTimelineView'), 'no Timeline view beside the tasks');
  assert.ok(!t.includes('All key dates'), 'no jump from a view that is gone');
  assert.ok(t.includes('Your next 3') && t.includes('of yours'), 'Your next 3, then All N of yours');
});

test('filed actions live in their working home, not twice under Decisions', () => {
  // An open action filed from a note or meeting already shows under What's next (its own) or Waiting
  // (someone else's): Decisions keeps the filed ones shown nowhere else (done, or with no home).
  const t = tabs();
  assert.ok(t.includes('Actions filed from its notes and meetings'), 'the heading stays');
  assert.ok(t.includes('decisionsFlowed('), 'one rule folds the duplicate into its home');
  const at = t.indexOf('export function DecisionsSection');
  const body = t.slice(at, at + 3000);
  assert.ok(!body.includes("a.from && a.ref.kind === 'record'") || body.includes('decisionsFlowed'), 'no unfiltered second listing');
});

// ── 2b. A person page: open promises once, finished ones in the Timeline ────

const work = mkdtempSync(path.join(tmpdir(), 'nv-t12-'));
let P;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/shared/people.ts'))};\nexport { buildRecordModel, personOpenItems } from ${JSON.stringify(path.join(root, 'src/shared/records.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'p.mjs'), format: 'esm' }, logLevel: 'silent' });
  P = await import(pathToFileURL(path.join(work, 'p.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

test('the Timeline keeps meetings, notes and finished promises, never the open ones', () => {
  const tl = P.personTimeline({
    meetings: [{ id: 'm1', title: 'Site walk', path: 'Meetings/Site walk.md', date: '2026-11-10' }],
    doneItems: [
      { id: 'd1', title: 'Sent the quote', path: 'Projects/Harbour.md', line: 12, date: '2026-11-05', side: 'you owe' },
      { id: 'd2', title: 'Approved the plan', path: 'Projects/Harbour.md', line: 20, side: 'they owe' },
    ],
    notes: [{ id: 'n1', title: 'Zebra notes', path: 'Notes/Zebra.md' }],
    projects: [{ id: 'p1', title: 'Harbour fit-out', path: 'Projects/Harbour.md' }],
  });
  assert.deepEqual(tl.map((e) => e.title), ['Site walk', 'Sent the quote', 'Approved the plan', 'Harbour fit-out', 'Zebra notes']);
  assert.deepEqual(tl.map((e) => e.kind), ['meeting', 'action', 'action', 'project', 'note']);
  assert.equal(tl[1].side, 'you owe');
  assert.equal(tl[2].side, 'they owe');
  assert.ok(tl[1].done && tl[2].done, 'timeline promises read finished');
  assert.deepEqual(P.personTimeline({ meetings: [], doneItems: [], notes: [], projects: [] }), []);
});

test('finished promises come with the card, either way, newest work first', () => {
  const note = (p, title, props, content) => ({ path: p, title, props, content, mtime: 0 });
  const model = P.buildRecordModel({
    today: '2026-11-08',
    notes: [
      note('People/Ana Ruiz.md', 'Ana Ruiz', { type: 'person' }, '# Ana Ruiz\n'),
      note('Projects/Harbour.md', 'Harbour', { type: 'project' }, '# Harbour\n\n- [x] Send the plan — Ana Ruiz · by 2026-11-02\n- [ ] Price the extras — Ana Ruiz · by 2026-11-20\n'),
    ],
  });
  const card = P.personCards(model).find((c) => c.name === 'Ana Ruiz');
  assert.ok(card.doneItems.some((d) => d.title === 'Send the plan'), 'the finished promise rides along');
  assert.ok(!card.doneItems.some((d) => d.title === 'Price the extras'), 'open promises stay out of it');
  assert.ok(card.owesYouItems.some((d) => d.title === 'Price the extras'), 'open promises keep their own list');
  const items = P.personOpenItems(model, 'Ana Ruiz');
  assert.ok(items.doneTheirs.some((r) => r.title === 'Send the plan'), 'theirs finished, by owner');
  assert.deepEqual(items.doneAbout, [], 'nothing finished about them');
});

test('the person page shows open promises once and reads finished ones as done', () => {
  const src = read('src/renderer/src/views/PersonPage.tsx');
  assert.ok(!src.includes('youOweItems]'), 'open promises no longer feed the Timeline');
  assert.ok(src.includes('· done'), 'a finished promise reads done');
  // With only open promises and nothing else, the page must not claim there is nothing with them.
  assert.ok(src.includes('youOweItems.length') && src.includes('owesYouItems.length'), 'the empty line counts the open promises');
});

// ── Live: nothing twice on the project and person pages ─────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('live: open promises read once on each page', async () => {
  const { startHarness } = await import('./vault-controls-harness.mjs');
  const h = await startHarness();
  try {
    for (let i = 0; i < 90; i++) {
      await sleep(500);
      try {
        if (await h.browser.ev(`!!document.querySelector('.app')`)) break;
      } catch {}
    }
    await sleep(1500);
    const clickWords = (words, scope = '') => h.browser.ev(`(async () => {
      const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
      const root = ${scope ? `document.querySelector(${JSON.stringify(scope)})` : 'document'};
      if (!root) return 'NOROOT';
      const els = [...root.querySelectorAll('button, a[href], [role="button"], [role="tab"]')].filter(vis);
      const el = els.find((e) => ((e.innerText || e.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').includes(${JSON.stringify(words)})));
      if (!el) return 'NOTFOUND';
      el.scrollIntoView({ block: 'nearest' }); el.click();
      await new Promise((r) => setTimeout(r, 600));
      return 'CLICKED';
    })()`);
    // With tabs (t255) each leg opens its tab first (t265): the tab reads selected, its panel shows.
    const openTab = async (id) => {
      await h.browser.ev(`document.querySelector('[data-tab="${id}"]')?.click()`);
      await sleep(900);
      assert.equal(await h.browser.ev(`document.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute('data-tab')`), id, `${id} reads selected`);
    };
    // The project's open filed action lives in its working home (Waiting: Priya's), not twice under Decisions;
    // the finished filed one stays under Decisions, shown nowhere else.
    assert.equal(await clickWords('Projects'), 'CLICKED', 'Projects opens');
    await sleep(800);
    assert.equal(await clickWords('Harbourline Cart Fix'), 'CLICKED', 'the project opens');
    await sleep(2000);
    await openTab('decisions');
    const flowed = () => h.browser.ev(`document.querySelector('#pj-panel-decisions [data-section="decisions"] .w2a-tworows')?.innerText ?? ''`);
    assert.ok((await flowed()).includes('Book the room'), 'the finished filed action stays under Decisions');
    assert.ok(!(await flowed()).includes('Retry the failed payment twice'), 'the open filed action is not twice under Decisions');
    await openTab('waiting');
    const waiting = () => h.browser.ev(`document.querySelector('#pj-panel-waiting [data-section="waiting"]')?.innerText ?? ''`);
    assert.ok((await waiting()).includes('Retry the failed payment twice'), 'the open filed action lives in Waiting');
    // The person's open promises live under Owes you only; the Timeline keeps the meeting, the note and the
    // finished promise.
    assert.equal(await clickWords('People'), 'CLICKED', 'People opens');
    await sleep(800);
    assert.equal(await clickWords('Alex Chen', 'main'), 'CLICKED', 'Alex Chen opens');
    await sleep(2000);
    await openTab('promises');
    const promises = () => h.browser.ev(`document.querySelector('#pp-panel-promises')?.innerText ?? ''`);
    const halves = () => h.browser.ev(`document.querySelector('#pp-panel-promises .w2b-halves')?.innerText ?? ''`);
    assert.ok((await promises()).includes('Send the receipt v2 for review'), 'the open promise shows');
    assert.ok((await promises()).includes('Owes you'), 'under Owes you');
    assert.ok(!(await halves()).includes('You owe'), 'the quiet half hides (t76: only sides that hold something read)');
    assert.ok(!(await promises()).includes('Nothing you owe them is open.'), 'no empty line reads beside owed rows');
    await openTab('timeline');
    const timeline = () => h.browser.ev(`(() => { const heads = [...document.querySelectorAll('#pp-panel-timeline .glabel.w2b-section')]; const t = heads.find((e) => (e.innerText || '').includes('Timeline'))?.nextElementSibling; return t ? t.innerText : ''; })()`);
    assert.ok(!(await timeline()).includes('Send the receipt v2 for review'), 'the open promise is not twice in the Timeline');
    assert.ok(!(await timeline()).includes('Chase the 2 carts that failed on Friday'), 'the other open promise is not twice either');
    assert.ok((await timeline()).includes('Book the room'), 'the finished promise reads in the Timeline');
    assert.ok((await timeline()).includes('They owe · done'), 'finished reads finished');
    await openTab('overview');
    const overview = () => h.browser.ev(`document.querySelector('#pp-panel-overview')?.innerText ?? ''`);
    assert.ok((await overview()).includes('Nothing you owe them is open.'), 'the Overview reads the empty side quietly');
    assert.ok((await overview()).includes('All 2'), 'the owed side ends in its tab');
    assert.ok(await h.browser.ev(`!![...document.querySelectorAll('#pp-panel-overview .pj-ov-all')].find((b) => (b.innerText || '').includes('All 2'))?.querySelector('svg')`), 'the All link draws its arrow, never a typed glyph');
    // A brand-new empty project keeps its short helpful start, never a blank page. The renderer only
    // learns a new file on boot (the folio walk's reload), so the file is written, rescanned and rebooted.
    const bareDir = path.join(h.vaultDir, 'Projects', 'Bare Start');
    mkdirSync(bareDir, { recursive: true });
    writeFileSync(path.join(bareDir, 'Bare Start.md'), '---\ntype: project\n---\n# Bare Start\n');
    await h.services.rescanAll();
    await h.browser.send('Page.navigate', { url: `${h.origin}/harness.html` });
    for (let i = 0; i < 90; i++) {
      await sleep(500);
      try {
        if (await h.browser.ev(`!!document.querySelector('.app')`)) break;
      } catch {}
    }
    await sleep(1500);
    assert.equal(await clickWords('Projects'), 'CLICKED', 'Projects reopens');
    await sleep(800);
    assert.equal(await clickWords('Bare Start', 'main'), 'CLICKED', 'the bare project opens');
    await sleep(2000);
    const start = await h.browser.ev(`document.querySelector('[data-folio-empty]')?.innerText ?? ''`);
    assert.ok(start.includes('Start this project'), 'the start reads, never a blank page');
    const starters = await h.browser.ev(`[...document.querySelectorAll('[data-folio-empty] [data-add]')].map((b) => b.getAttribute('data-add')).join(',')`);
    assert.equal(starters, 'whats-next,notes,key-dates', 'task, note and key date one click away');
  } finally {
    await h.close().catch(() => {});
  }
});
