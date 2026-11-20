// node --test tests/project-folio.test.mjs — a project's folio (5 Nov 2026, the vault folio): the hero, 8 tabs
// and 4 cards became one calm page — title, one status line, then What's next, Waiting, Chats, Key dates,
// People, Decisions, Notes, Files, Risks, Updates, Money and Activity under a sticky section line that jumps and
// scrolls. Chats joined 9 Nov 2026 (one product: the page holds its former host app chats, in the view only).
// Long lists fold with "Show all". Board, Calendar and Timeline stay one click away as views of the tasks. Every
// old tab link lands on its section, and layout presets keep working. Fails without each change.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { startHarness } from './vault-controls-harness.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const memory = () => read('src/renderer/src/views/project/memory.ts');
const page = () => read('src/renderer/src/views/ProjectPage.tsx');
const tabs = () => read('src/renderer/src/views/project/ProjectTabs87.tsx');
const css = () => read('src/renderer/src/styles/w2a.css');

test('the folio walks the briefed order, with the words the sticky line and the heads share', () => {
  // t255: the section bar became real tabs, Overview first — the sections keep their words and order.
  const folio = memory().slice(memory().indexOf('export const FOLIO_SECTIONS'), memory().indexOf('export type ProjectTabId'));
  const ids = [...folio.matchAll(/\{ id: '([a-z-]+)', title: (?:"(.+?)"|'(.+?)') \}/g)].map((m) => [m[1], m[2] ?? m[3]]);
  // Step 2, 12 Nov 2026: yours, waiting, questions, dates, notes, people, decisions, risks, then the
  // rest. Chats moved after the work reads (one product's mock predates the approved order); t239's
  // merged Notes and files stays one list.
  assert.deepEqual(ids, [
    ['whats-next', 'Your next'],
    ['waiting', 'Waiting on others'],
    ['questions', 'Open questions'],
    ['key-dates', 'Key dates'],
    ['notes', 'Notes and files'],
    ['people', 'People'],
    ['decisions', 'Decisions'],
    ['risks', 'Risks'],
    ['updates', 'Updates'],
    ['money', 'Money'],
    ['activity', 'Activity'],
  ]);
  const tabsBlock = memory().slice(memory().indexOf('export const PROJECT_TABS'));
  assert.ok(tabsBlock.includes("{ id: 'overview', title: 'Overview' }"), 'Overview heads the tabs');
  assert.ok(tabsBlock.includes("FOLIO_SECTIONS.filter((s) => s.id !== 'files')"), 'then every section in the folio’s own order (t239: Files stays merged, never its own tab)');
  for (const [id, title] of ids) {
    if (id === 'whats-next') {
      // t249: the head reads once — "Your next 3" folded, "Your next N" opened, "Your next" when short —
      // never "Your next" holding "Your next 3".
      assert.ok(/title=\{head\}/.test(tabs()), 'Your next reads its head once, naming what it shows');
      assert.ok(tabs().includes("'Your next 3'"), 'the folded head names its three, as the plan sketches');
      continue;
    }
    assert.ok(new RegExp(`<Section[^>]*id="${id}"[^>]*title="${title}"`, 's').test(tabs()), `${title} renders as its section`);
  }
});

test('every old tab link lands on its section, and the page still remembers where the person was', () => {
  const m = memory();
  // t239: an old files tab lands on the merged list.
  for (const [tab, section] of [['tasks', 'whats-next'], ['notes', 'notes'], ['files', 'notes'], ['people', 'people'], ['money', 'money'], ['decisions', 'decisions'], ['timeline', 'key-dates']]) {
    assert.ok(m.includes(`case '${tab}':`) && m.includes(`return '${section}'`), `${tab} lands on ${section}`);
  }
  assert.ok(m.includes("sectionForTab(tab: ProjectTab | 'details' | undefined)"), 'a remembered Details tab lands too (top)');
  for (const id of ['whats-next', 'waiting', 'questions', 'key-dates', 'people', 'decisions', 'notes', 'files', 'risks', 'updates', 'money', 'activity']) {
    assert.ok(m.includes(`case '${id}':`), `${id} maps back to a remembered tab`);
  }
  const p = page();
  // t255: the open tab is history (Back returns to the tab), memory (the last tab per project) and the
  // remembered tab still lands at the top — v9's "halfway down the page" stays fixed, one tab at a time.
  assert.ok(p.includes('usePageTabs({ tabId: wtab.id'), 'the one shared hook holds history, memory and reveal');
  assert.ok(p.includes('section: wtab.section'), 'history says which tab is open');
  assert.ok(p.includes('sectionForTab(memory.tab) ?? undefined'), 'an old remembered tab lands on its section, as old links do');
  assert.ok(p.includes("defaultTab: 'overview'"), 'a fresh open lands on Overview');
  const wst = read('src/renderer/src/state/workspace.ts');
  assert.ok(wst.includes('export function setTabSection'), 'opening a tab stands in history');
  assert.ok(wst.includes('section: place.section, back:') && wst.includes('section: place.section, forward:'), 'Back and Forward carry the tab');
  const ws = read('src/renderer/src/views/Workspace.tsx');
  assert.ok(ws.includes('<PageTop tab={tab}>') && ws.includes('takeRestore(tab.id)'), 'Back and tab switches restore in the shared wrapper');
  assert.ok(p.includes('pj-expand'), 'a revealed line opens every fold on the way');
});

test('the title block: hero tile, title, pill and lead with Read more — no eyebrow, lede or status line', () => {
  // v9, 6 Nov 2026 (the folio "gone away from looking polished like it use to"): the hero is back on the folio
  // — the tabs page's tile, name, status pill and lead. A long summary reads as its lead until asked. t255: the
  // head stays fixed, with the name, the standing, the status and the real tabs under it.
  const p = page();
  assert.ok(p.includes('nv-hero') && p.includes('gtile') && p.includes('w2a-psub'), 'hero tile, title and lead');
  assert.ok(p.includes('{standing.words}') && p.includes('chooseStatus'), 'the status pill reads the one standing, and its menu (one fact, one value, 8 Nov 2026)');
  assert.ok(p.includes('w2a-readmore') && p.includes('Read more') && p.includes('Read less'), 'one quiet Read more for a long summary');
  assert.ok(p.includes('pj-stickhead'), 'the head stays fixed');
  assert.ok(p.includes('<PageTabs tabs={tabs}'), 'the section bar is real tabs');
  assert.ok(p.includes('PROJECT_TABS.map'), 'every tab stands, never hidden, so the order never shifts');
  const head = p.slice(p.indexOf('pj-stickhead'), p.indexOf('<PageTabs'));
  assert.ok(!head.includes('pj-eyebrow') && !head.includes('pj-lede'), 'no eyebrow or lede in the folio head');
  assert.ok(!p.includes('<StatusLine') && !p.includes('pj-statusline'), 'no status line repeating the band');
  assert.ok(!p.includes('OverviewTab') && !p.includes('TasksTab'), 'no 8.7 tabs left on the page');
  const bar = read('src/renderer/src/components/PageTabs.tsx');
  assert.ok(bar.includes('role="tablist"') && bar.includes('role="tab"') && p.includes('role="tabpanel"'), 'a real tablist, tabs and panels');
  assert.ok(bar.includes("ArrowRight") && bar.includes("ArrowLeft") && bar.includes('aria-selected'), 'arrows move, Enter opens, the open tab reads selected');
});

test('the tabs carry quiet counts, as the old tabs did — never zero clutter', () => {
  // v10, 6 Nov 2026, the old tabs had them; t255 counts every tab (t249: each tab's count equals its rows).
  // Zero shows nothing: an empty tab reads quietly, never hidden.
  const t = tabs();
  assert.ok(t.includes('export function tabCounts'), 'one count per tab, beside the sections');
  const counts = t.slice(t.indexOf('export function tabCounts'), t.indexOf('export function tabCounts') + 1400);
  for (const id of ['whats-next', 'waiting', 'questions', 'key-dates', 'notes', 'people', 'decisions', 'risks', 'updates', 'money', 'activity']) assert.ok(counts.includes(id), `${id} is counted`);
  const bar = read('src/renderer/src/components/PageTabs.tsx');
  assert.ok(bar.includes('t.count !== undefined && t.count > 0'), 'zero shows nothing, never clutter');
  assert.ok(bar.includes('is-quiet'), 'an empty tab reads quietly');
  assert.ok(read('src/renderer/src/styles/page-tabs.css').includes('.pt-tab .pt-count'), 'the counts read quiet, never pills');
});

test('nothing the tabs could do is lost: layouts, lifecycle, the nudge in Key dates, agents and every section primary', () => {
  const p = page();
  // Step 2: the went-by nudge folded into Key dates (its words kept), marked where each date sits.
  for (const s of ['LayoutSuggestion', 'LayoutDashboard', 'Lifecycle']) {
    assert.ok(p.includes(s), `${s} still heads or tails the page`);
  }
  assert.ok(!p.includes('dates went by. Did they happen?') && !p.includes('1 date went by. Did it happen?'), 'no banner above the sections any more');
  const t = tabs();
  for (const [section, action] of [['whats-next', 'Add task'], ['notes', 'Add note'], ['people', 'Add person'], ['decisions', 'Log decision'], ['key-dates', 'Milestone']]) {
    const part = t.slice(t.indexOf(`id="${section}"`), t.indexOf(`id="${section}"`) + 400);
    assert.ok(part.includes(action), `${section} carries ${action} in its head`);
  }
  // Money's early returns (bills off, loading, none yet) come first: its head is the last of its sections.
  const moneyHead = t.slice(t.lastIndexOf('id="money"'), t.lastIndexOf('id="money"') + 400);
  assert.ok(moneyHead.includes('New bill'), 'money carries New bill in its head');
  // t239, brief-directed: the merged list carries Add note and Attach in its one head.
  const notesHead = t.slice(t.indexOf('title="Notes and files"'), t.indexOf('title="Notes and files"') + 900);
  assert.ok(notesHead.includes('> Add note<') && notesHead.includes('> Attach<'), 'Notes and files carries Add note and Attach in its head');
});

test('Money with bills off is never a dead button: the quiet tab switches on and starts one', () => {
  // 5 Nov 2026, folio merge: "Open Finance" opened nothing while the pack was off (openModule stays silent by
  // the F2 rule). t255: bills off reads as the Money tab's quiet panel, and its Add a bill switches on and
  // opens the first bill in one click — the pack first, since a part alone never wakes it. Reading only,
  // the button does not show: there is nothing to switch.
  const t = tabs();
  assert.ok(t.includes('export function switchBillsOn'), 'the switch lives beside the section');
  assert.ok(t.includes("setModule('finance', true).then(() => setModule('finance', true, 'bills'))"), 'the pack first, then the part');
  const start = t.slice(t.indexOf('export function startSection'), t.indexOf('export function startSection') + 1500);
  assert.ok(start.includes('switchBillsOn().then(() => addBill(null'), 'one click switches on and starts the first bill');
  assert.ok(!t.includes("label: 'Switch bills on'"), 'no second switch beside the Add');
  const p = page();
  const empty = p.slice(p.indexOf('function TabEmpty'), p.indexOf('function TabEmpty') + 1800);
  assert.ok(empty.includes('Bills are off.'), 'the quiet tab says so plainly');
  assert.ok(empty.includes('{canEdit && starter'), 'reading only, the Add does not show');
  // New bill opens a record form, so the page hosts one: without it the click silently does nothing.
  assert.ok(p.includes('<RecordFormHost />'), 'the page hosts the record form New bill opens');
});

test('long lists fold with "Show all", back to "Show less"', () => {
  const t = tabs();
  assert.ok(t.includes('Show all ${total}') && t.includes('Show less'), 'the one fold opener');
  assert.ok((t.match(/<ShowAll /g) ?? []).length >= 11, 'every long list folds');
  assert.ok(t.includes('useExpandAll(ctx.path'), 'folds open for a revealed line');
});

test('one view per list: no Show-as switch on the tasks (decision 2)', () => {
  // Step 2: Your next 3, then All N of yours — one flat list, no Rows, Board, Calendar or Timeline switch.
  const t = tabs();
  assert.ok(!t.includes(`(['rows', 'board', 'calendar', 'timeline'] as const)`), 'the Show-as switch is gone');
  assert.ok(!t.includes('TasksTimelineView') && !t.includes('TasksCalendar'), 'no second date list beside the tasks');
  assert.ok(t.includes('Your next 3') && t.includes('of yours'), 'Your next 3, then All N of yours');
});

test('the folio keeps the page column, pairs side columns on a wide window, and sticks its line — theme tokens only', () => {
  const c = css();
  assert.ok(c.includes('.vpage.wide.pj-folio { max-width: 980px'), 'narrow windows keep the 980 folio');
  // At 3456 wide, 5 Nov 2026: the folio held at 1120 while the rooms widened past it, so F11's island lived
  // on. The folio steps with the rooms now (a held 1120 rule still stands mid-sheet, settled by these later
  // ones).
  assert.ok(/@container pj \(min-width: 1400px\)\s*\{[^}]*\.vpage\.wide\.pj-folio \{ max-width: 1280px/s.test(c), 'a roomy folio joins the 1280 rooms');
  // Step 2: no white oceans — the extra width goes to side columns, DOM order unchanged.
  assert.ok(/@container pj \(min-width: 2000px\)\s*\{[^}]*\.vpage\.wide\.pj-folio \{ max-width: 2080px; display: grid/s.test(c), 'the widest folio pairs side columns');
  // t267: the section line is the tab bar in the fixed head now — the dead folionav rules went with the foot.
  assert.ok(c.includes('.pj-stickhead { position: sticky; top: 0'), 'the head with the tabs sticks');
  assert.ok(c.includes('.pj-page:has(.pj-folio) { overflow: visible'), 'the page lets it stick');
  const folio = c.slice(c.indexOf('The project folio (5 Nov 2026'));
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(folio), 'no colour but the theme tokens');
  const words = memory().match(/title: (?:".+?"|'.+?')/g).join(' ') + ' Show all Show less';
  assert.ok(!/—|…/.test(words), 'no em dash or ellipsis in the new words');
});

test('key dates and milestones are one list: each date edits, opens and removes one way', () => {
  const t = tabs();
  assert.ok(t.includes('function KeyDateRow'), 'one row for a key date');
  // Step 2: the went-by nudge folded in here from the banner, its words kept; the rows share the one
  // component with the gone-by mark.
  assert.ok(t.includes('went by. Did it happen?') || t.includes('went by. Did they happen?'), 'Key dates keeps the nudge');
  assert.ok(t.includes('<KeyDateRow key={m.id} ctx={ctx} m={m} wentBy={'), 'the rows share the one component, marked');
  const row = t.slice(t.indexOf('function KeyDateRow'), t.indexOf('function KeyDateRow') + 1800);
  assert.ok(row.includes('<InlineDate') && row.includes('<Inline'), 'its day and words edit where they show');
  assert.ok(row.includes('RowAction') && row.includes('line.remove(index)'), 'it removes where it shows');
});

test('the folio live: Overview first, every tab opens its whole list, quiet tabs read quietly (t255)', async () => {
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
    const openTab = async (id) => {
      await h.browser.ev(`document.querySelector('[data-tab="${id}"]')?.click()`);
      await sleep(900);
    };
    assert.equal(await clickWords('Projects'), 'CLICKED', 'Projects opens');
    await sleep(800);
    assert.equal(await clickWords('Harbourline Cart Fix'), 'CLICKED', 'the project opens');
    await sleep(1500);
    // t255: thirteen tabs in the briefed order, Overview first — never hidden, so the order never shifts
    // (Files lists nothing in the harness — project:files is stubbed null — and Updates, Money, Open
    // questions and Chats hold nothing in this vault: those tabs read quietly instead of hiding).
    const order = await h.browser.ev(`[...document.querySelectorAll('[role="tab"]')].map((el) => el.getAttribute('data-tab')).join(',')`);
    assert.equal(order, 'overview,whats-next,waiting,questions,key-dates,notes,people,decisions,risks,updates,money,activity', 'twelve tabs in the briefed order');
    const quiet = await h.browser.ev(`[...document.querySelectorAll('[role="tab"].is-quiet')].map((el) => el.getAttribute('data-tab')).sort().join(',')`);
    assert.equal(quiet, 'money,questions,updates', 'the empty tabs read quietly, never hidden');
    assert.equal(await h.browser.ev(`document.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute('data-tab')`), 'overview', 'a fresh open lands on Overview');
    assert.ok(await h.browser.ev(`!!document.querySelector('[data-section="overview"] .pj-ov')`), 'the Overview reads its blocks');
    const words = await h.browser.ev(`document.querySelector('.pj-page')?.innerText ?? ''`);
    for (const empty of ['No tasks yet', 'No key dates yet', 'No decisions recorded yet', 'Nobody named yet', 'No notes here yet', 'No files yet', 'No risks named yet', 'Bills are switched off', 'No folder on this PC yet']) {
      assert.ok(!words.includes(empty), `no "${empty}" on show`);
    }
    // t255 replaces t12's nothing-empty rule on this page: an empty block reads one quiet line (this
    // vault holds no updates, questions, chats or bills).
    assert.ok(words.includes('No updates yet.'), 'the empty updates block reads quietly on the Overview');
    await openTab('money');
    assert.ok((await h.browser.ev(`document.querySelector('[data-section="money"]')?.innerText ?? ''`)).includes('Bills are off.'), 'bills off reads quietly');
    await openTab('updates');
    assert.ok((await h.browser.ev(`document.querySelector('[data-section="updates"]')?.innerText ?? ''`)).includes('No updates yet.'), 'no updates reads quietly');
    await openTab('questions');
    assert.ok((await h.browser.ev(`document.querySelector('[data-section="questions"]')?.innerText ?? ''`)).includes('No open questions.'), 'no questions reads quietly');
    // Key dates counts the dates gone by and marks each where it sits (step 2: the banner folded in here).
    await openTab('key-dates');
    const kd = await h.browser.ev(`document.querySelector('[data-section="key-dates"]')?.innerText ?? ''`);
    assert.ok(kd.includes('1 date went by. Did it happen?'), 'Key dates keeps the nudge');
    assert.ok(kd.includes('Went by') && kd.includes('Did it happen?') && kd.includes('It happened'), 'the gone-by date asks on its own row');
    assert.ok(!kd.includes('Retry fix live (milestone). Did they happen?'), 'the nudge never names the dates');
    // The head stays fixed: scrolled to the bottom, the name and the tabs still show.
    await h.browser.ev(`document.querySelector('.vscroll').scrollTo({ top: 99999 })`);
    await sleep(600);
    const stuck = await h.browser.ev(`(() => {
      const sc = document.querySelector('.vscroll').getBoundingClientRect();
      const hero = document.querySelector('.pj-stickhead .nv-hero h1').getBoundingClientRect();
      const bar = document.querySelector('.pj-stickhead [role="tablist"]').getBoundingClientRect();
      return { hero: Math.round(hero.top - sc.top), bar: Math.round(bar.top - sc.top) };
    })()`);
    assert.ok(stuck.hero >= -4 && stuck.bar >= -4, `the head stays fixed (hero ${stuck.hero}px, tabs ${stuck.bar}px)`);
    // A long list shows whole in its tab: eight open steps, no fold, each row ticking where it shows.
    const fs = await import('node:fs');
    const proj = `${h.vaultDir}/Projects/Harbourline Cart Fix/Harbourline Cart Fix.md`;
    const before = fs.readFileSync(proj, 'utf8');
    const extra = [7, 8, 9, 10, 11, 12].map((d) => `- [ ] Ring the supplier about the November shortfall, docket ${d} — Alex Chen — due 2026-11-${d}`).join('\n');
    fs.writeFileSync(proj, before.replace("## What's next\n\n", `## What's next\n\n${extra}\n`));
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
    assert.equal(await clickWords('Harbourline Cart Fix'), 'CLICKED', 'the project reopens');
    await sleep(1500);
    await openTab('whats-next');
    const whole = await h.browser.ev(`(() => {
      const sec = document.querySelector('[data-section="whats-next"]');
      const rows = [...sec.querySelectorAll('[data-item^="next:"]')].filter((el) => el.getBoundingClientRect().height > 2).length;
      const fold = [...sec.querySelectorAll('.pj-showall')].find((b) => (b.innerText || '').startsWith('All '));
      return { rows, fold: fold ? fold.innerText.trim() : null };
    })()`);
    assert.equal(whole.rows, 8, `all eight show (saw ${whole.rows})`);
    assert.equal(whole.fold, null, 'no fold in the tab: the whole list reads');
    // The quiet Money tab switches on and starts the first bill in one click.
    await openTab('money');
    assert.ok((await h.browser.ev(`document.querySelector('[data-section="money"]')?.innerText ?? ''`)).includes('Bills are off.'), 'bills off reads quietly');
    assert.equal(await clickWords('Add a bill', '[data-section="money"]'), 'CLICKED', 'Add a bill answers');
  } finally {
    await h.close().catch(() => {});
  }
}, { timeout: 600000 });
