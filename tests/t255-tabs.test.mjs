// node --test tests/t255-tabs.test.mjs — long pages become tabs (t255, 13 Nov 2026). The project page's
// endless scroll became real tabs under a fixed head: Overview first, then every section in its own words
// and order, each tab whole at full width with its own Find past one screen and its own Add. One shared
// bar, hook and Find; history, memory and reveal through the one hook. A real-input walk on a big project
// like a real one (31 next steps, 14 people, 11 key dates, 51 notes and files, 11 decisions, 7 risks): every
// tab opens with its count equal to its rows, Back returns to the tab, the remembered tab restores, a
// search hit opens its tab and flashes its row, Overview never scrolls wide, and no column stands empty.
// Made-up vault only. Fails without each change.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { clickWords, openRoom, sleep, waitFor } from './t152-lib.mjs';
import { startHarness } from './vault-controls-harness.mjs';

const root = path.join(import.meta.dirname, '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const D = (off) => iso(new Date(Date.now() + off * 864e5));

// ── Static: the shared mechanism, written once ─────────────────────────────

test('one shared bar, hook and Find: history, memory and reveal live in one place', () => {
  const bar = read('src/renderer/src/components/PageTabs.tsx');
  assert.ok(bar.includes('export function PageTabs') && bar.includes('export function usePageTabs') && bar.includes('export function TabFind'), 'one component, one hook, one Find');
  assert.ok(bar.includes('role="tablist"') && bar.includes('role="tab"'), 'a real tablist');
  assert.ok(bar.includes("ArrowRight") && bar.includes("ArrowLeft") && bar.includes('aria-selected'), 'arrows move, Enter opens');
  assert.ok(bar.includes('setTabSection'), 'the open tab stands in history');
  assert.ok(bar.includes('remember(active)'), 'the open tab is remembered per page');
  assert.ok(bar.includes('flash(item)'), 'a reveal flashes its row once its tab mounts');
  const page = read('src/renderer/src/views/ProjectPage.tsx');
  assert.ok(page.includes("from '../components/PageTabs'") && page.includes('usePageTabs({ tabId: wtab.id'), 'the project page walks through it, never its own copy');
  const ws = read('src/renderer/src/state/workspace.ts');
  assert.ok(ws.includes('section?: string') && ws.includes('export function setTabSection'), 'the tab travels in history');
  const top = read('src/renderer/src/views/Workspace.tsx');
  assert.ok(top.includes('placeKey(tab.id, tab.type, tab.path, tab.section)'), 'each tab keeps its own scroll');
  assert.ok(top.includes('firstSight'), 'a fresh visit lands every tab at the top');
});

test('Overview first, then every section in its own words and order, never hidden', () => {
  const mem = read('src/renderer/src/views/project/memory.ts');
  assert.ok(mem.includes("{ id: 'overview', title: 'Overview' }"), 'Overview heads the tabs');
  assert.ok(mem.includes("FOLIO_SECTIONS.filter((s) => s.id !== 'files')"), 'then every section in the folio’s order (Files stays merged)');
  const page = read('src/renderer/src/views/ProjectPage.tsx');
  assert.ok(page.includes('PROJECT_TABS.map'), 'every tab stands, so the order never shifts');
  assert.ok(page.includes('pj-stickhead'), 'the head stays fixed: name, standing, status, tabs');
  assert.ok(page.includes('role="tabpanel"'), 'each tab is a labelled panel');
});

test('every tab counts what its list shows; an empty tab reads quietly', () => {
  const t = read('src/renderer/src/views/project/ProjectTabs87.tsx');
  const counts = t.slice(t.indexOf('export function tabCounts'), t.indexOf('export function tabCounts') + 1400);
  for (const id of ['whats-next', 'waiting', 'questions', 'key-dates', 'notes', 'people', 'decisions', 'risks', 'updates', 'money', 'activity']) assert.ok(counts.includes(id), `${id} is counted`);
  assert.ok(counts.includes('decisionsFlowed'), 'decisions count their flowed rows too');
  const bar = read('src/renderer/src/components/PageTabs.tsx');
  assert.ok(bar.includes('t.count !== undefined && t.count > 0'), 'zero shows no badge, never clutter');
  assert.ok(bar.includes('is-quiet'), 'an empty tab reads quietly');
  const p = read('src/renderer/src/views/ProjectPage.tsx');
  assert.ok(p.includes('function TabEmpty') && p.includes('startSection(id, ctx, edit'), 'a quiet tab carries its own Add');
});

test('the Overview is the ten-second read, each block ending in its tab', () => {
  const t = read('src/renderer/src/views/project/ProjectTabs87.tsx');
  const ov = t.slice(t.indexOf('export function OverviewSection'));
  for (const [block, tab] of [['Your next', 'whats-next'], ['Waiting on others', 'waiting'], ['Key dates', 'key-dates'], ['Latest updates', 'updates'], ['Latest decisions', 'decisions'], ['Open risks', 'risks'], ['People', 'people']]) {
    assert.ok(ov.includes(`aria-label="${block}"`) && ov.includes(`all('${tab}'`), `${block} ends in All N for ${tab}`);
  }
  assert.ok(ov.includes('All {n}'), 'the one All N link all blocks share');
  // Layout round 3: a roomy window (useRoomy, 1800x900 and up) shows each block whole in its own pane; a smaller
  // one keeps three rows each.
  assert.ok(ov.includes('const cap = roomy ? 50 : 3;'), 'three rows a block, every row on a roomy window');
  assert.ok(ov.includes('mine.slice(0, cap)') && ov.includes('kd.coming.slice(0, cap)'), 'next steps and key dates by that cap');
  assert.ok(ov.includes('updates.slice(-cap)') && ov.includes('decisions.slice(0, cap)'), 'the latest updates and decisions by that cap');
  assert.ok(ov.includes('openRisksRanked(p)'), 'open risks by rank');
  const ovDate = t.slice(t.indexOf('function OvDateRow'), t.indexOf('function OvDateRow') + 1500);
  assert.ok(ovDate.includes('<WentByAsk index={index}'), 'a past date asks its question, answered in one click');
  assert.ok(!ov.includes('standingWords'), 'the standing reads once, in the fixed head above — never twice');
});

test('Ctrl+K go to still finds each section', () => {
  const modals = read('src/renderer/src/components/Modals.tsx');
  assert.ok(modals.includes('pjgoto:') && modals.includes('Go to ${t.title}'), 'the palette names every tab');
  assert.ok(modals.includes("detail: { path: ctx.path, section:") || modals.includes('pj-goto'), 'picking one tells the page');
  assert.ok(read('src/renderer/src/views/ProjectPage.tsx').includes("addEventListener('pj-goto'"), 'the page opens the named tab');
});

test('t253 inside the tabs: flowed rows hide your own name, delivered files read as rows', () => {
  const t = read('src/renderer/src/views/project/ProjectTabs87.tsx');
  assert.ok(t.includes('visibleWho(a.person || a.who, ctx.hub.me)'), 'a filed row ends in who it is with, never your own name');
  assert.ok(t.includes('<DeliveredRow key={f.id} f={f} />'), 'agent deliveries read as rows, not tall cards');
  const card = read('src/renderer/src/components/DeliveredFile.tsx');
  assert.ok(card.includes('export function DeliveredRow'), 'the row lives with the card, one opener for both');
  assert.ok(card.includes('openDelivered(f)'), 'one opener for card and row');
  assert.ok(card.includes('delivered it') && card.includes('sizeWords(f.size)'), 'every fact stays: what, kind, size, who, when, where');
  const row = card.slice(card.indexOf('export function DeliveredRow'), card.indexOf('export function DeliveredCard'));
  assert.ok((row.match(/<button/g) ?? []).length === 3 && row.includes('Show in folder'), 'the name plus both buttons stay');
});

// ── Live: one boot, a big, realistic project ─────────────────────────────

const BIG = 'Projects/Harbour Festival Build/Harbour Festival Build.md';
const PEOPLE = ['Alex Chen', 'Bettina Maddox', 'Darcy Lin', 'Priya Nair', 'June Park', 'Tom Bradley', 'Lucy Hammond', 'Mia Kaur', 'Sam Ortega', 'Jay Lu', 'Wandi Siregar', 'Thaddeus Vance', 'Arlen Fenwick', 'Nadia Rahman'];
let H = null;
async function harness() {
  if (!H) {
    const exts = ['pdf', 'pdf', 'pptx', 'xlsx', 'png', 'docx', 'pdf', 'zip', 'json', 'csv'];
    const groups = [{ name: '', files: [] }, { name: 'Stalls', files: [] }];
    for (let i = 0; i < 31; i++) {
      const ext = exts[i % exts.length];
      const name = `Build file ${i + 1}.${ext}`;
      const g = i % 3 === 2 ? groups[1] : groups[0];
      const rel = g.name ? `${g.name}/${name}` : name;
      g.files.push({ rel, name, ext, size: 12000 + i * 700, modified: Date.now() - (i % 9) * 864e5 });
    }
    H = await startHarness({ projectFiles: { folder: path.join(tmpdir(), `nv-t255-tabs-${Date.now()}`), exists: true, groups, total: 31, more: 0 } });
    await H.services.invoke('settings:update', [{ prefs: { modules: { meetings: { on: true } }, statusLine: true } }]);
    const w = (rel, text) => {
      const p = path.join(H.vaultDir, ...rel.split('/'));
      mkdirSync(path.dirname(p), { recursive: true });
      writeFileSync(p, text);
    };
    const steps = [];
    for (let i = 0; i < 24; i++) steps.push(`- [ ] Festival job number ${i + 1} across the north wharf — Alex Chen — due ${D([-3, -1, 0, 2, 5][i % 5])}`);
    steps.push('- [ ] Clarify the north wording — Bettina Maddox', '- [ ] Align on cover — Darcy Lin', '- [ ] Chase the lighting quote — Priya Nair', '- [ ] Confirm the lane closure — June Park', '- [ ] Book the night crew — Tom Bradley');
    steps.push('- [x] Walk the site with the crew — Alex Chen', '- [x] Print the survey forms — Alex Chen');
    const dates = [
      `| ${D(-20)} | Stalls booked | Done |`, `| ${D(-1)} | Lighting check with the crew | Planned |`, `| ${D(0)} | Team check-in |  |`,
      `| ${D(2)} | Rooms confirmed |  |`, `| ${D(5)} | Traders briefing |  |`, `| ${D(9)} | Power and water walk |  |`,
      `| ${D(12)} | Sign-off on the map |  |`, `| ${D(16)} | Bump-in starts |  |`, `| ${D(21)} | Opening night |  |`,
      `| ${D(28)} | Bump-out done |  |`, `| ${D(35)} | Wash-up meeting |  |`,
    ];
    w(BIG, `---\ntype: project\nstatus: active\nhealth: at risk\nowner: Alex Chen\ndue: ${D(14)}\n---\n# Harbour Festival Build\n\n## Summary\n\nThe summer festival build across the north wharf, with stalls, power and the night crew.\n\n## What's next\n\n${steps.join('\n')}\n\n## Key dates\n\n| Date | Milestone | Status |\n|---|---|---|\n${dates.join('\n')}\n\n## People\n\n${PEOPLE.map((n) => `- ${n}`).join('\n')}\n\n## Decisions\n\n${Array.from({ length: 11 }, (_, i) => `- ${D(-30 + i * 3)}: Festival decision number ${i + 1} on the north wharf plan`).join('\n')}\n\n## Risks\n\n- The card reader fails again on a busy Saturday (owner: Alex Chen, level: high)\n- Rain on opening night (level: medium)\n- The late truck misses bump-in (owner: Darcy Lin, level: high)\n- Power trips on the main stage (level: medium)\n- First-aid tent unstaffed at peak (owner: Mia Kaur, level: low)\n- Ice delivery runs short (level: low)\n- Lost kids point moves twice (level: medium)\n\n## Updates\n\n${Array.from({ length: 6 }, (_, i) => `- ${D(-6 + i)}: Festival update number ${i + 1}: the build moves along`).join('\n')}\n\n## Notes\n\nThe build in short.\n`);
    for (let n = 0; n < 20; n++) w(`Projects/Harbour Festival Build/Notes/Build note ${n + 1}.md`, `---\ntype: note\nproject: ${BIG}\n---\n# Build note ${n + 1}\n\nThe build notes, part ${n + 1}.\n`);
    for (let n = 0; n < 5; n++) {
      w(`Projects/Harbour Festival Build/Meetings/Festival meeting ${n + 1}.md`, `---\ntype: meeting\nproject: ${BIG}\ndate: ${D(-14 + n * 4)}\n---\n# Festival meeting ${n + 1}\n\n- [ ] Follow up on meeting ${n + 1} — Bettina Maddox\n${n === 0 ? '- [x] Posted the printed roster — Alex Chen\n- [x] Counted the till float — Bettina Maddox\n' : ''}\n## Questions\n\n${n < 2 ? `- ? Who brings the spare reader for meeting ${n + 1}?\n` : ''}\nDiscussed the stalls and the power walk.\n`);
    }
    await H.services.rescanAll();
    await H.browser.send('Page.navigate', { url: `${H.origin}/harness.html` });
    assert.ok(await waitFor(H, `!!document.querySelector('.app')`, 45000), 'the app boots');
    await sleep(2500);
  }
  return H;
}
before(async () => { await harness(); }, { timeout: 600000 });
after(async () => { await H?.close().catch(() => {}); H = null; });

async function openProject(h) {
  await openRoom(h, 'Projects');
  assert.equal(await clickWords(h, 'Harbour Festival Build', 'main'), 'CLICKED', 'the project opens');
  assert.ok(await waitFor(h, `!!document.querySelector('.pj-page')`, 15000), 'the page lands');
  await sleep(2000);
}
async function openTab(h, id) {
  await h.browser.ev(`document.querySelector('[data-tab="${id}"]')?.click()`);
  await sleep(1000);
}
async function size(h, W, Hg) {
  await h.browser.send('Emulation.setDeviceMetricsOverride', { width: W, height: Hg, deviceScaleFactor: 2, mobile: false });
  await sleep(900);
}
async function tabCount(h, id) {
  return h.browser.ev(`(() => {
    const el = document.querySelector('[data-tab="${id}"]');
    const badge = el?.querySelector('.pt-count')?.innerText.trim();
    return { title: (el?.innerText ?? '').replace(/\\s+/g, ' ').trim(), count: badge === undefined ? null : Number(badge), quiet: el?.classList.contains('is-quiet') ?? null };
  })()`);
}

test('every tab opens and its count equals its rows', { timeout: 300000 }, async () => {
  const h = await harness();
  await size(h, 1920, 1117);
  await openProject(h);
  const order = await h.browser.ev(`[...document.querySelectorAll('[role="tab"]')].map((el) => el.getAttribute('data-tab')).join(',')`);
  assert.equal(order, 'overview,whats-next,waiting,questions,key-dates,notes,people,decisions,risks,updates,money,activity', 'twelve tabs in order');
  // Each tab's rows, as its count counts them (t249): open steps, waiting items, questions, every date,
  // the All list, people, decisions with flowed rows, open risks, updates with deliveries, bills, activity.
  const rows = {
    'whats-next': `[data-section="whats-next"] [data-item^="next:"]`,
    waiting: `[data-section="waiting"] [data-action]`,
    questions: `[data-item-card="questions"] .trow`,
    'key-dates': `[data-section="key-dates"] [data-item^="dates:"]`,
    notes: `[data-item-card="files"] .trow`,
    people: `[data-section="people"] [data-person]`,
    decisions: `[data-section="decisions"] [data-item^="decisions:"], [data-section="decisions"] .w2a-tworows .trow`,
    risks: `[data-section="risks"] [data-item^="risks:"]`,
    updates: `[data-section="updates"] [data-item^="updates:"], [aria-label="Delivered by agents"] .trow`,
    activity: `[data-section="activity"] .trow`,
  };
  for (const [id, sel] of Object.entries(rows)) {
    await openTab(h, id);
    const badge = await tabCount(h, id);
    assert.equal(badge.quiet, false, `${id} reads open, not quiet`);
    // Rows on show only: a tab already visited stays mounted, hidden, so it comes back at once (its rows would count twice).
    const n = await h.browser.ev(`[...document.querySelectorAll(${JSON.stringify(sel)})].filter((el) => el.getClientRects().length > 0 && ${id === 'whats-next' ? '!el.closest("details")' : 'true'}).length`);
    assert.equal(badge.count, n, `${id}: the count equals its rows (${badge.count} vs ${n})`);
    const selected = await h.browser.ev(`document.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute('data-tab')`);
    assert.equal(selected, id, `${id} reads selected`);
  }
  // Whats-next shows the whole list unfolded: 24 open, Done folded with its own count.
  const next = await h.browser.ev(`(() => {
    const sec = document.querySelector('[data-section="whats-next"]');
    return {
      open: [...sec.querySelectorAll('[data-item^="next:"]')].filter((el) => !el.closest('details')).length,
      done: sec.querySelector('details.tkdone summary')?.innerText.replace(/\\s+/g, ' ') ?? null,
      fold: !!sec.querySelector('.pj-showall'),
    };
  })()`);
  assert.equal(next.open, 24, 'all 24 open steps show, unfolded');
  assert.equal(next.done, 'Done 2', 'Done keeps its own count');
  assert.equal(next.fold, false, 'no fold in the tab');
});

test('a tab with nothing reads quietly, never hidden — with its own Add', { timeout: 300000 }, async () => {
  const h = await harness();
  await openProject(h);
  await openTab(h, 'overview');
  const money = await tabCount(h, 'money');
  assert.equal(money.count, null, 'money shows no badge');
  assert.equal(money.quiet, true, 'money reads quietly');
  await openTab(h, 'money');
  assert.ok((await h.browser.ev(`document.querySelector('[data-section="money"]')?.innerText ?? ''`)).includes('Bills are off.'), 'bills off reads quietly');
  assert.equal(await clickWords(h, 'Add a bill', '[data-section="money"]'), 'CLICKED', 'its own Add answers');
});

test('Back returns to the tab', { timeout: 300000 }, async () => {
  const h = await harness();
  await openProject(h);
  await openTab(h, 'overview');
  await openTab(h, 'whats-next');
  await openTab(h, 'people');
  const back = `document.querySelector('button[aria-label="Back"]')`;
  await h.browser.ev(`${back}?.click()`);
  await sleep(1000);
  assert.equal(await h.browser.ev(`document.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute('data-tab')`), 'whats-next', 'Back returns to Your next');
  await h.browser.ev(`${back}?.click()`);
  await sleep(1000);
  assert.equal(await h.browser.ev(`document.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute('data-tab')`), 'overview', 'and Back again to Overview');
});

test('the remembered tab is restored after reopening', { timeout: 300000 }, async () => {
  const h = await harness();
  await openProject(h);
  await openTab(h, 'risks');
  await sleep(800);
  await openRoom(h, 'Today');
  await sleep(800);
  await openProject(h);
  assert.equal(await h.browser.ev(`document.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute('data-tab')`), 'risks', 'the last tab opened restores');
  await openTab(h, 'overview');
});

test('a task from Today opens its tab and flashes its row', { timeout: 300000 }, async () => {
  const h = await harness();
  await openRoom(h, 'Today');
  await sleep(1500);
  const btn = `document.querySelector('main .td-row button.td-act[title="Open Harbour Festival Build"]')`;
  assert.ok(await waitFor(h, `!!(${btn})`, 10000), 'Today names the project with an opener');
  await h.browser.ev(`(${btn})?.click()`);
  assert.ok(await waitFor(h, `!!document.querySelector('.pj-page')`, 15000), 'the project opens');
  await sleep(1500);
  const tab = await h.browser.ev(`document.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute('data-tab')`);
  assert.ok(tab === 'whats-next' || tab === 'waiting', `its tab opens (${tab})`);
  assert.ok(await h.browser.ev(`!!document.querySelector('.tl-revealed')`), 'its row flashes');
  assert.ok(await h.browser.ev(`document.querySelector('[data-revealed="true"]')?.getAttribute('aria-current') === 'true'`), 'the row reads current');
});

test('a due date from Today opens Facts and flashes its row', { timeout: 300000 }, async () => {
  const h = await harness();
  await openRoom(h, 'Today');
  await sleep(1500);
  // The project's own due date lists in Also › Later ("Harbour Festival Build is due", flagged).
  const shown = await h.browser.ev(`(async () => {
    // Today since layout round 2: the Later group stands in the day's list; More for today (the fold) may hold it.
    const also = document.querySelector('main [data-section="also"]');
    const fold = also ? [...also.querySelectorAll('button.td-more')].find((b) => (b.innerText || '').includes('Show')) : null;
    if (fold && fold.getAttribute('aria-expanded') !== 'true') { fold.click(); await new Promise((r) => setTimeout(r, 800)); }
    const group = document.querySelector('main .td-group.later');
    if (!group) return 'NOLATER';
    const more = [...group.querySelectorAll('button')].find((b) => (b.innerText || '').startsWith('Show all'));
    if (more) { more.click(); await new Promise((r) => setTimeout(r, 800)); }
    const row = [...group.querySelectorAll('.td-row')].find((r) => r.querySelector('.td-glyph.flag') && (r.innerText || '').includes('is due'));
    if (!row) return 'NOROW';
    row.querySelector('button.td-act[title^="Open "]')?.click();
    return 'CLICKED';
  })()`);
  assert.equal(shown, 'CLICKED', 'the due line opens');
  assert.ok(await waitFor(h, `!!document.querySelector('.pj-page')`, 15000), 'the project opens');
  assert.ok(await waitFor(h, `!!document.querySelector('.tl-revealed')`, 15000), 'the Due row flashes');
  // Facts holds the due date: the folio's tabs yield, the Due row shows and reads current.
  assert.ok(await h.browser.ev(`!!document.querySelector('.page-props [data-item="due"]')?.getClientRects().length`), 'Facts shows the Due row');
  assert.equal(await h.browser.ev(`!!document.querySelector('.pj-page [role="tablist"]')`), false, 'the folio tabs yield to Facts');
  assert.equal(await h.browser.ev(`document.querySelector('[data-revealed="true"]')?.getAttribute('data-item')`), 'due', 'the Due row reads current');
});

test('Overview has no scroll wide, and stays short narrow', { timeout: 300000 }, async () => {
  const h = await harness();
  await openProject(h);
  for (const [W, Hg] of [[3456, 1408], [1920, 1117]]) {
    await size(h, W, Hg);
    await openTab(h, 'overview');
    const m = await h.browser.ev(`(() => { const sc = document.querySelector('.vscroll'); return { scroll: sc.scrollHeight, client: sc.clientHeight }; })()`);
    assert.ok(m.scroll <= m.client + 2, `${W}: Overview never scrolls (${m.scroll} in ${m.client})`);
    const blocks = await h.browser.ev(`[...document.querySelectorAll('[data-section="overview"] .pj-ov-block')].map((el) => el.getAttribute('aria-label')).join(',')`);
    assert.equal(blocks, 'Your next,Waiting on others,Key dates,Latest updates,Latest decisions,Open risks,People', `${W}: every block reads`);
  }
  await size(h, 1219, 709);
  await openTab(h, 'overview');
  const narrow = await h.browser.ev(`document.querySelector('[data-section="overview"] .pj-ov').getBoundingClientRect().height`);
  assert.ok(narrow < 2600, `1219: it stays short enough to scan (${Math.round(narrow)}px)`);
});

test('no column wider than about 400px stands empty', { timeout: 300000 }, async () => {
  const h = await harness();
  await size(h, 1920, 1117);
  await openProject(h);
  // Beside content: down each tab, the widest gap between content boxes on any content line stays narrow
  // (bare margins between blocks are not columns standing empty).
  const scan = `(() => {
    const panel = [...document.querySelectorAll('[role="tabpanel"]')].find((el) => el.getClientRects().length > 0);
    const fr = panel.getBoundingClientRect();
    const boxes = [...panel.querySelectorAll('.trow, .card, .pj-ov-block, .pj-folio-head, .pt-find, p.pj-faint, .pj-ov-names')]
      .map((el) => el.getBoundingClientRect()).filter((r) => r.width > 4 && r.height > 4);
    let worst = 0;
    for (let y = fr.top + 20; y < fr.bottom - 10; y += 150) {
      const cuts = boxes.filter((r) => y >= r.top && y <= r.bottom).map((r) => [Math.max(r.left, fr.left), Math.min(r.right, fr.right)]).sort((a, b) => a[0] - b[0]);
      if (!cuts.length) continue;
      let edge = fr.left;
      for (const [a, b] of cuts) { worst = Math.max(worst, a - edge); edge = Math.max(edge, b); }
      worst = Math.max(worst, fr.right - edge);
    }
    return Math.round(worst);
  })()`;
  for (const id of ['overview', 'whats-next', 'waiting', 'questions', 'key-dates', 'notes', 'people', 'decisions', 'risks', 'updates', 'money', 'activity']) {
    await openTab(h, id);
    const worst = await h.browser.ev(scan);
    assert.ok(worst < 400, `${id}: no empty column beside content (widest gap ${worst}px)`);
  }
});

test('keyboard: arrows move on the bar, Enter opens; roles read right', { timeout: 300000 }, async () => {
  const h = await harness();
  await openProject(h);
  await openTab(h, 'overview');
  const roles = await h.browser.ev(`(() => ({
    list: document.querySelector('[role="tablist"]')?.getAttribute('aria-label') ?? null,
    tabs: document.querySelectorAll('[role="tab"]').length,
    panels: document.querySelectorAll('[role="tabpanel"]').length,
    controls: document.querySelector('[data-tab="people"]')?.getAttribute('aria-controls'),
    panelled: document.querySelector('#pj-panel-people')?.getAttribute('aria-labelledby'),
  }))()`);
  assert.equal(roles.list, 'Project sections', 'the bar labels itself');
  assert.equal(roles.tabs, 12, 'twelve tabs');
  assert.equal(roles.panels, 12, 'twelve panels');
  assert.equal(roles.controls, 'pj-panel-people', 'each tab controls its panel');
  assert.equal(roles.panelled, 'pj-tab-people', 'each panel names its tab');
  await h.browser.ev(`document.querySelector('[data-tab="overview"]')?.focus()`);
  await sleep(300);
  const key = async (k, code, vc) => {
    await h.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vc });
    await h.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vc });
    await sleep(400);
  };
  await key('ArrowRight', 'ArrowRight', 39);
  assert.equal(await h.browser.ev(`document.activeElement?.getAttribute('data-tab')`), 'whats-next', 'Right moves focus');
  assert.equal(await h.browser.ev(`document.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute('data-tab')`), 'overview', 'moving never opens');
  await key('Enter', 'Enter', 13);
  await sleep(600);
  assert.equal(await h.browser.ev(`document.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute('data-tab')`), 'whats-next', 'Enter opens');
  await key('ArrowLeft', 'ArrowLeft', 37);
  assert.equal(await h.browser.ev(`document.activeElement?.getAttribute('data-tab')`), 'overview', 'Left moves back');
  await key('End', 'End', 35);
  assert.equal(await h.browser.ev(`document.activeElement?.getAttribute('data-tab')`), 'activity', 'End jumps to the last');
  await key('Home', 'Home', 36);
  assert.equal(await h.browser.ev(`document.activeElement?.getAttribute('data-tab')`), 'overview', 'Home jumps to the first');
});

test('a long tab earns its own Find; switching never reloads, each tab keeps its scroll', { timeout: 300000 }, async () => {
  const h = await harness();
  await size(h, 1920, 1117);
  await openProject(h);
  await openTab(h, 'whats-next');
  assert.ok(await waitFor(h, `!!document.querySelector('[role="tabpanel"]:not([style*="none"]) input[aria-label="Find in this list"]')`, 8000), 'the 24-row tab earns a Find');
  await openTab(h, 'questions');
  assert.ok(!(await h.browser.ev(`!!document.querySelector('#pj-panel-questions input[aria-label="Find in this list"]')`)), 'the 2-row tab earns none');
  // Each tab keeps its own scroll (the whole lists, unfiltered, scroll past one screen).
  await openTab(h, 'whats-next');
  await h.browser.ev(`document.querySelector('.vscroll').scrollTo({ top: 420 })`);
  await sleep(400);
  await openTab(h, 'people');
  await h.browser.ev(`document.querySelector('.vscroll').scrollTo({ top: 120 })`);
  await sleep(400);
  await openTab(h, 'whats-next');
  const top = await h.browser.ev(`document.querySelector('.vscroll').scrollTop`);
  assert.ok(Math.abs(top - 420) < 40, `its own scroll stands (${Math.round(top)}px)`);
  await openTab(h, 'people');
  const top2 = await h.browser.ev(`document.querySelector('.vscroll').scrollTop`);
  assert.ok(Math.abs(top2 - 120) < 40, `and People keeps its own (${Math.round(top2)}px)`);
  // The Find filters where it stands; away and back it stands as left — no reload, no flash.
  await openTab(h, 'whats-next');
  await h.browser.ev(`document.querySelector('#pj-panel-whats-next input[aria-label="Find in this list"]')?.focus()`);
  await h.browser.send('Input.insertText', { text: 'job number 7' });
  await sleep(700);
  const found = await h.browser.ev(`(() => {
    const rows = [...document.querySelectorAll('#pj-panel-whats-next [data-item^="next:"]')].filter((el) => el.getClientRects().length > 0);
    const n = document.querySelector('#pj-panel-whats-next .pt-find-n')?.innerText ?? '';
    return { rows: rows.length, n };
  })()`);
  assert.equal(found.rows, 1, 'the Find filters to its row');
  assert.equal(found.n, '1 of 26', 'naming what it shows (the Find searches Done too)');
  await openTab(h, 'people');
  await openTab(h, 'whats-next');
  const kept = await h.browser.ev(`(() => ({
    q: document.querySelector('#pj-panel-whats-next input[aria-label="Find in this list"]')?.value ?? '',
    rows: [...document.querySelectorAll('#pj-panel-whats-next [data-item^="next:"]')].filter((el) => el.getClientRects().length > 0).length,
  }))()`);
  assert.equal(kept.q, 'job number 7', 'the query stands');
  assert.equal(kept.rows, 1, 'the filter stands: no reload');
  await h.browser.ev(`document.querySelector('#pj-panel-whats-next .pt-find-x')?.click()`);
  await sleep(500);
});

test('Ctrl+K go to finds each tab', { timeout: 300000 }, async () => {
  const h = await harness();
  await openProject(h);
  await openTab(h, 'overview');
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75 });
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75 });
  assert.ok(await waitFor(h, `!!document.querySelector('.picker input')`, 5000), 'the palette opens');
  await h.browser.send('Input.insertText', { text: 'Go to People' });
  await sleep(900);
  const row = await h.browser.ev(`[...document.querySelectorAll('.picker-row')].find((x) => (x.querySelector('.picker-label')?.innerText || '') === 'Go to People') ? 'FOUND' : 'MISSING'`);
  assert.equal(row, 'FOUND', 'Go to People answers');
  await h.browser.ev(`[...document.querySelectorAll('.picker-row')].find((x) => (x.querySelector('.picker-label')?.innerText || '') === 'Go to People')?.click()`);
  await sleep(1200);
  assert.equal(await h.browser.ev(`document.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute('data-tab')`), 'people', 'picking it opens the tab');
});

test('a person’s tabs: Overview first, then Promises, Projects and Timeline, never hidden', () => {
  const mem = read('src/renderer/src/views/personMemory.ts');
  assert.ok(mem.includes("{ id: 'overview', title: 'Overview' }"), 'Overview heads the tabs');
  assert.ok(mem.includes("{ id: 'promises', title: 'Promises' }"), 'then Promises, Projects and Timeline');
  const src = read('src/renderer/src/views/PersonPage.tsx');
  assert.ok(src.includes('usePageTabs({ tabId: tab.id'), 'through the one shared hook: history, memory, no reload');
  assert.ok(src.includes('PERSON_TABS.map'), 'every tab stands, so the order never shifts');
  assert.ok(src.includes('<TabFind id="promises"') && src.includes('<TabFind id="timeline"'), 'long tabs earn the shared Find');
  assert.ok(src.includes('aria-label="Latest timeline"') && src.includes("all(timeline.length, 'timeline')"), 'each Overview block ends in its tab');
  assert.ok(src.includes('No open promises between you.') && src.includes('No shared projects.'), 'empty tabs read one quiet line');
});

test('filed rows hide your own name and name others; updates read as compact rows', { timeout: 300000 }, async () => {
  const h = await harness();
  await openProject(h);
  await openTab(h, 'decisions');
  const flowed = await h.browser.ev(`[...document.querySelectorAll('[data-section="decisions"] .w2a-tworows .trow')].map((r) => r.innerText.replace(/\\s+/g, ' '))`);
  const mine = flowed.find((t) => t.includes('Posted the printed roster'));
  assert.ok(mine, 'a done filed step of yours reads under Decisions');
  assert.ok(!mine.includes('Alex Chen'), `without your own name (${mine})`);
  const theirs = flowed.find((t) => t.includes('Counted the till float'));
  assert.ok(theirs && theirs.includes('Bettina Maddox'), `naming who it is with (${theirs})`);
  await openTab(h, 'updates');
  const heights = await h.browser.ev(`[...document.querySelectorAll('[data-section="updates"] .trow')].map((r) => Math.round(r.getBoundingClientRect().height))`);
  assert.ok(heights.length >= 6, 'the updates stand to judge');
  for (const px of heights) assert.ok(px < 72, `as compact as the page's other rows (${px}px)`);
});

async function openPerson(h, name) {
  await openRoom(h, 'People');
  await sleep(1500);
  await h.browser.ev(`[...document.querySelectorAll('main button.trow.w2b-row')].find((b) => (b.getAttribute('title') || '') === 'Everything about ${name}')?.click()`);
  assert.ok(await waitFor(h, `!!document.querySelector('.w2b-person')`, 15000), `${name}'s page lands`);
  await sleep(2000);
}

test('a person’s tabs walk: Overview, counts, whole lists, Back and memory', { timeout: 300000 }, async () => {
  const h = await harness();
  await size(h, 1920, 1117);
  await openPerson(h, 'Alex Chen');
  const order = await h.browser.ev(`[...document.querySelectorAll('.w2b-person [role="tab"]')].map((el) => el.getAttribute('data-tab')).join(',')`);
  assert.equal(order, 'overview,promises,projects,timeline', 'four tabs in order');
  const counts = await h.browser.ev(`(() => {
    const badge = (id) => document.querySelector('.w2b-person [data-tab="' + id + '"] .pt-count')?.innerText ?? null;
    return { promises: badge('promises'), projects: badge('projects'), timeline: badge('timeline') };
  })()`);
  assert.ok(Number(counts.promises) >= 24 && Number(counts.projects) >= 1 && Number(counts.timeline) >= 1, `every tab counts (${JSON.stringify(counts)})`);
  // Each count equals its rows (t249).
  for (const [id, sel] of [['promises', '#pp-panel-promises .trow'], ['projects', '#pp-panel-projects .trow'], ['timeline', '#pp-panel-timeline .trow']]) {
    await h.browser.ev(`document.querySelector('.w2b-person [data-tab="${id}"]')?.click()`);
    await sleep(800);
    const n = await h.browser.ev(`document.querySelectorAll('${sel}').length`);
    assert.equal(Number(counts[id]), n, `${id} counts its rows (${counts[id]} vs ${n})`);
  }
  await h.browser.ev(`document.querySelector('.w2b-person [data-tab="overview"]')?.click()`);
  await sleep(800);
  const blocks = await h.browser.ev(`[...document.querySelectorAll('#pp-panel-overview .pj-ov-block')].map((el) => el.getAttribute('aria-label')).join(',')`);
  assert.equal(blocks, 'You owe,Owes you,Projects,Latest timeline', 'the Overview reads its four blocks');
  const alls = await h.browser.ev(`[...document.querySelectorAll('#pp-panel-overview .pj-ov-all')].map((el) => ({ t: el.innerText.replace(/\\s+/g, ' ').trim(), icon: !!el.querySelector('svg') }))`);
  assert.equal(alls.length, 3, `the three full blocks end in their tabs (${alls.map((a) => a.t).join(' | ')})`);
  for (const a of alls) {
    assert.ok(/^All \d+$/.test(a.t), `All N for its tab (${a.t})`);
    assert.ok(a.icon, `the All link draws its arrow, never a typed glyph (${a.t})`);
  }
  const m = await h.browser.ev(`(() => { const sc = document.querySelector('.nv-page-scroll'); return { scroll: sc.scrollHeight, client: sc.clientHeight }; })()`);
  assert.ok(m.scroll <= m.client + 2, `the Overview never scrolls (${m.scroll} in ${m.client})`);
  // Promises shows the whole list unfolded, with its own Find past one screen.
  await h.browser.ev(`document.querySelector('.w2b-person [data-tab="promises"]')?.click()`);
  await sleep(1000);
  const rows = await h.browser.ev(`document.querySelectorAll('#pp-panel-promises .trow').length`);
  assert.ok(rows >= 24, `the whole list reads (${rows} rows)`);
  assert.ok(await waitFor(h, `!!document.querySelector('#pp-panel-promises input[aria-label="Find in this list"]')`, 8000), 'the long tab earns a Find');
  // Back returns to the tab; reopening restores the remembered one.
  await h.browser.ev(`document.querySelector('.w2b-person [data-tab="timeline"]')?.click()`);
  await sleep(800);
  await h.browser.ev(`document.querySelector('button[aria-label="Back"]')?.click()`);
  await sleep(1000);
  assert.equal(await h.browser.ev(`document.querySelector('.w2b-person [role="tab"][aria-selected="true"]')?.getAttribute('data-tab')`), 'promises', 'Back returns to Promises');
  await openRoom(h, 'Today');
  await sleep(800);
  await openPerson(h, 'Alex Chen');
  assert.equal(await h.browser.ev(`document.querySelector('.w2b-person [role="tab"][aria-selected="true"]')?.getAttribute('data-tab')`), 'promises', 'the remembered tab restores');
});

test('a bare person reads one line, every tab quiet', { timeout: 300000 }, async () => {
  const h = await harness();
  const p = path.join(H.vaultDir, 'People', 'Calm Person.md');
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, `---\ntype: person\nrole: Occasional helper\n---\n# Calm Person\n\nMet once at the market.\n`);
  await H.services.rescanAll();
  await openPerson(h, 'Calm Person');
  assert.ok((await h.browser.ev(`document.querySelector('#pp-panel-overview')?.innerText ?? ''`)).includes('Nothing with Calm Person yet.'), 'one line, no bare heads');
  const quiet = await h.browser.ev(`[...document.querySelectorAll('.w2b-person [role="tab"].is-quiet')].map((el) => el.getAttribute('data-tab')).sort().join(',')`);
  assert.equal(quiet, 'projects,promises,timeline', 'every tab reads quietly');
});

// ── t261: the tabs never proven full, the long rooms on a rich vault, the head card ──
// (13 Nov 2026). t255 left Money/Chats/Updates populated paths unproven live, the rooms measured only on thin
// data, and the head card tall with overlapping faces. A second boot (H2) carries the proofs: the big project
// with a year of real-shaped bills, three linked conversations and an agent delivery, a 200-step project with
// 60 files, and a made-up vault of realistic size (30 live projects, 40 meetings with actions, 12 goals, a house,
// trips, sites, systems, 18 visits). Made-up vault only. Fails without each change.

const BIG2 = 'Projects/Harbour Festival Build/Harbour Festival Build.md';
const LONG2 = 'Projects/Long Haul Refit/Long Haul Refit.md';
// One real PDF's bytes (the t253 shape), so a delivered file opens in the folder viewer, never as gone.
const pdfBytes = (title, line) => {
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const content = `BT /F1 24 Tf 72 770 Td (${title}) Tj ET BT /F1 12 Tf 72 736 Td (${line}) Tj ET`;
  objs.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  let out = '%PDF-1.4\n';
  const offsets = [0];
  objs.forEach((o, i) => { offsets.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 6\n0000000000 65535 f \n` + offsets.slice(1).map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('') + `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, 'latin1');
};

let H2 = null;
let H2FOLDER = '';
async function harness2() {
  if (!H2) {
    H2FOLDER = path.join(tmpdir(), `nv-t261-h2-${Date.now()}`);
    mkdirSync(path.join(H2FOLDER, 'Delivered'), { recursive: true });
    const dl = pdfBytes('Closeout', 'Delivered by the agent.');
    writeFileSync(path.join(H2FOLDER, 'Delivered', 'Closeout report.pdf'), dl);
    const exts = ['pdf', 'pptx', 'xlsx', 'png', 'docx', 'pdf', 'zip', 'json', 'csv', 'md'];
    const groups = [{ name: '', files: [] }, { name: 'Plans', files: [] }];
    for (let i = 0; i < 60; i++) {
      const ext = exts[i % exts.length];
      const name = `Haul file ${i + 1}.${ext}`;
      const g = i % 3 === 2 ? groups[1] : groups[0];
      const rel = g.name ? `${g.name}/${name}` : name;
      g.files.push({ rel, name, ext, size: 9000 + i * 500, modified: Date.now() - (i % 9) * 864e5 });
    }
    groups[0].files.push({ rel: 'Delivered/Closeout report.pdf', name: 'Closeout report.pdf', ext: 'pdf', size: dl.length, modified: Date.now() - 864e5 });
    const now = Date.now();
    H2 = await startHarness({
      projectFiles: { folder: H2FOLDER, exists: true, groups, total: 61, more: 0 },
      projectWork: [
        { id: 'c1', title: 'Stall layout brainstorm', updatedAt: now - 3600e3, running: false, kind: 'chat' },
        { id: 'c2', title: 'Roster script fixes', updatedAt: now - 864e5, running: false, kind: 'code' },
        { id: 'c3', title: 'Night crew planning', updatedAt: now - 300e3, running: true, kind: 'cowork' },
      ],
      agentDelivered: [
        { id: 'd1', at: now - 7200e3, agentName: 'Chief', name: 'Closeout report.pdf', ext: 'pdf', size: dl.length, what: 'The closeout summary for the build', place: 'folder', path: 'Delivered/Closeout report.pdf', abs: path.join(H2FOLDER, 'Delivered', 'Closeout report.pdf'), project: { path: BIG2, name: 'Harbour Festival Build' }, exists: true },
      ],
    });
    await H2.services.invoke('settings:update', [{ prefs: { modules: Object.fromEntries(['meetings', 'finance', 'health', 'goals', 'systems', 'sites', 'house', 'travel'].map((id) => [id, { on: true }])), statusLine: true } }]);
    const w = (rel, text) => {
      const p = path.join(H2.vaultDir, ...rel.split('/'));
      mkdirSync(path.dirname(p), { recursive: true });
      writeFileSync(p, text);
    };
    const steps = [];
    for (let i = 0; i < 24; i++) steps.push(`- [ ] Festival job number ${i + 1} across the north wharf — Alex Chen — due ${D([-3, -1, 0, 2, 5][i % 5])}`);
    steps.push('- [ ] Clarify the north wording — Bettina Maddox', '- [ ] Align on cover — Darcy Lin', '- [ ] Chase the lighting quote — Priya Nair', '- [ ] Confirm the lane closure — June Park', '- [ ] Book the night crew — Tom Bradley');
    steps.push('- [x] Walk the site with the crew — Alex Chen', '- [x] Print the survey forms — Alex Chen');
    w(BIG2, `---\ntype: project\nstatus: active\nhealth: at risk\nowner: Alex Chen\ndue: ${D(14)}\n---\n# Harbour Festival Build\n\n## Summary\n\nThe summer festival build across the north wharf, with stalls, power and the night crew.\n\n## What's next\n\n${steps.join('\n')}\n\n## Key dates\n\n| Date | Milestone | Status |\n|---|---|---|\n${[`| ${D(-20)} | Stalls booked | Done |`, `| ${D(-1)} | Lighting check with the crew | Planned |`, `| ${D(0)} | Team check-in |  |`, `| ${D(2)} | Rooms confirmed |  |`, `| ${D(5)} | Traders briefing |  |`].join('\n')}\n\n## People\n\n${PEOPLE.map((x) => `- ${x}`).join('\n')}\n\n## Decisions\n\n${Array.from({ length: 4 }, (_, i) => `- ${D(-30 + i * 3)}: Festival decision number ${i + 1}`).join('\n')}\n\n## Risks\n\n- The card reader fails again on a busy Saturday (owner: Alex Chen, level: high)\n- Rain on opening night (level: medium)\n\n## Updates\n\n${Array.from({ length: 6 }, (_, i) => `- ${D(-6 + i)}: Festival update number ${i + 1}: the build moves along`).join('\n')}\n\n## Notes\n\nThe build in short.\n`);
    // The long project: 200 steps of yours, 60 files beside them.
    const haul = [];
    for (let i = 0; i < 200; i++) haul.push(`- [ ] Haul task number ${i + 1} along the wharf road — Alex Chen — due ${D((i % 30) - 5)}`);
    haul.push('- [x] Open the haul', '- [x] Walk the haul');
    w(LONG2, `---\ntype: project\nstatus: active\nhealth: on track\nowner: Alex Chen\ndue: ${D(60)}\n---\n# Long Haul Refit\n\n## Summary\n\nTwo hundred small tasks and sixty files.\n\n## What's next\n\n${haul.join('\n')}\n\n## People\n\n- Alex Chen\n- Bettina Maddox\n`);
    // A year of real-shaped bills: 15 on the big project, dues across twelve months, kinds and cycles
    // mixed, four already paid and one paused; 8 of the household's beside them.
    const projBills = ['Wharf Power', 'Stallholder Bonds', 'Festival Insurance', 'Night Crew Wages', 'Sound Hire', 'Marquee Hire', 'Security Roster', 'First Aid Cover', 'Waste Removal', 'Signage Print', 'Radio Hire', 'Generator Fuel', 'Water Cartage', 'Ticketing Fees', 'Cleaning Crew'];
    const rows = projBills.map((nm, i) => `| ${nm} | ${i % 4 === 1 ? 'Subscription' : 'Bill'} | ${(120 + i * 43.25).toFixed(2)} | ${['Monthly', 'Quarterly', 'Yearly'][i % 3]} | ${D(-180 + i * 24)} | Home and utilities | Everyday | Harbour Festival Build | ${i % 2 ? 'Yes' : 'No'} | ${i === 14 ? 'Paused' : 'Active'} | ${i < 4 ? D(-170 + i * 24) : ''} |  |`);
    ['Harbour Internet', 'Streamly', 'Power', 'Water', 'Council Rates', 'Phone', 'Gym', 'Gas'].forEach((nm, i) => rows.push(`| ${nm} | Bill | ${(40 + i * 22).toFixed(2)} | Monthly | ${D(3 + i * 4)} | Home and utilities | Everyday |  | No | Active |  |  |`));
    w('Finance/Bills.md', `---\ntype: bills-table\ntable: bills\nversion: 1\n---\n# Bills\n\nOne line per bill. You can read this file; the Money page reads it too.\n\n| Name | Kind | Amount | Cycle | Due | Category | Account | Project | Autopay | Status | Paid | Note file |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n${rows.join('\n')}\n`);
    w('Finance/Accounts/Everyday.md', `---\ntype: bank-account\nbank: Harbour Mutual\nbalance: 2450.75\n---\n# Everyday\n`);
    // The rich rooms: 30 live projects, 40 meetings with actions, 12 goals, a house, trips, sites, systems.
    for (let i = 0; i < 30; i++) {
      const name = `Rich Job ${200 + i} Refit`;
      w(`Projects/${name}/${name}.md`, `---\ntype: project\nstatus: active\nhealth: ${i % 3 === 0 ? 'at risk' : 'on track'}\nowner: ${PEOPLE[i % PEOPLE.length]}\ndue: ${D(10 + i)}\n---\n# ${name}\n\n## Summary\n\nRefit number ${200 + i}.\n\n## What's next\n\n- [ ] Open job ${200 + i} — ${PEOPLE[i % PEOPLE.length]} — due ${D(5 + i)}\n- [ ] Price job ${200 + i} — ${PEOPLE[(i + 1) % PEOPLE.length]}\n`);
    }
    for (let i = 0; i < 40; i++) {
      w(`Meetings/${D(-120 + i * 3)} Festival session ${i + 1}.md`, `---\ntype: meeting\ndate: ${D(-120 + i * 3)}\nattendees: [Alex Chen, Bettina Maddox]\nproject: ${i % 2 ? BIG2 : ''}\n---\n# Festival session ${i + 1}\n\n## Agenda\n\n- The stalls and the power walk\n\n## Actions\n\n- [ ] Follow up on session ${i + 1} — Bettina Maddox — due ${D(-100 + i * 3)}\n- [x] Book the room — Alex Chen\n\n## Decisions\n\n- The stalls open first\n`);
    }
    ['Run a half marathon', 'Save the house deposit', 'Read 24 books', 'Learn Auslan basics', 'Cycle to work weekly', 'Grow the vegie patch', 'Finish the shed fit-out', 'Walk 8000 steps daily', 'Cut screen time', 'Learn sourdough', 'Save for Japan', 'Fix the back fence'].forEach((g, i) => w(`Me/Goals/${g}.md`, `---\ntype: goal\ncategory: Fitness\nby: ${D(60 + i * 20)}\nunit: km\nstart_value: 0\ntarget_value: ${100 + i * 50}\nstatus: On track\nwhy: Goal number ${i + 1}.\n---\n# ${g}\n\n## Milestones\n\n| Milestone | Day | Done |\n| --- | --- | --- |\n| First quarter | ${D(20 + i * 5)} | Yes |\n| Halfway | ${D(40 + i * 5)} | No |\n`));
    ['Morning run', 'Read before bed', 'No sugary drinks', 'Tidy the desk', 'Call mum', 'Stretch', 'Floss', 'Make the bed'].forEach((hb) => w(`Me/Goals/${hb}.md`, `---\ntype: habit\nstatus: Active\ndays_a_week: 3\n---\n# ${hb}\n\n## Log\n\n${D(-4)}\n\n## Notes\n\nKeep it up.\n`));
    w('Home/House/Home.md', `---\ntype: house\naddress: 4 Example Lane\nownership: Renting\nmoved_in: 2024-02-01\n---\n# Home\n`);
    ['Dishwasher', 'Fridge', 'Washing machine', 'Dryer', 'Oven', 'Air conditioner', 'Hot water unit', 'Vacuum', 'TV', 'Lawn mower'].forEach((a, i) => w(`Home/House/Appliances/${a}.md`, `---\ntype: appliance\nkind: ${a}\nroom: Kitchen\nmake: Brightline\npurchased: 2024-11-20\nprice: ${200 + i * 150}\nwarranty: ${D(30 + i * 25)}\nstatus: In use\n---\n# ${a}\n`));
    ['Clean the gutters', 'Service the air conditioner', 'Test the smoke alarms', 'Reseal the deck', 'Flush the hot water unit', 'Clean the rangehood filters', 'Check the flexi hoses', 'Trim the back hedge', 'Oil the deck gate', 'Descale the kettle', 'Wash the windows', 'Mow the nature strip'].forEach((j, i) => w(`Home/House/Maintenance/${j}.md`, `---\ntype: upkeep\nevery: Monthly\nlast_done: ${D(-90 + i * 10)}\nroom: Roof\nstatus: Active\n---\n# ${j}\n`));
    ['Harbour City', 'Byron Bay', 'Melbourne', 'Perth', 'Adelaide', 'Hobart', 'Darwin', 'Cairns'].forEach((d, i) => w(`Me/Travel/Trips/${d} – Trip ${i + 1}.md`, `---\ntype: trip\ndestination: ${d}\npurpose: ${i % 2 ? 'Holiday' : 'Work'}\nstarts: ${D(-200 + i * 45)}\nends: ${D(-196 + i * 45)}\nstatus: ${i < 6 ? 'Done' : 'Booked'}\nbudget: ${1200 + i * 200}\n---\n# ${d} – Trip ${i + 1}\n\n## Itinerary\n\n| Date | Time | Kind | What | Until | Where | Booking | Cost | Paid | Notes |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n| ${D(-200 + i * 45)} | 07:05 | Flight | QF 41${i} | 08:35 | Terminal 3 | QX7P${i} | 289 | Yes | |\n`));
    ['Harbour Office', 'North Wharf Stall', 'Museum Store', 'Shop Front', 'Back Warehouse', 'Market Tent'].forEach((s) => w(`Work/Sites/${s}.md`, `---\ntype: site\nkind: Office\nstatus: Live\n---\n# ${s}\n\n## Rooms\n\n| Room | Floor | Notes |\n| --- | --- | --- |\n| Server room | 2 | |\n`));
    ['Core switch', 'Till reader', 'Office printer', 'CCTV recorder', 'Wi-Fi controller', 'NAS box', 'Card reader spare', 'Label printer', 'Door controller', 'UPS unit', 'Meeting screen', 'Spare till'].forEach((dv, i) => w(`Work/Sites/Devices/${dv}.md`, `---\ntype: device\nsite: "[[${['Harbour Office', 'North Wharf Stall'][i % 2]}]]"\nkind: Switch\nstatus: Live\nwarranty: ${D(100 + i * 20)}\n---\n# ${dv}\n`));
    ['Office server', 'Shop till PC', 'Spare laptop', 'Raspberry Pi', 'Old desktop', 'Media box', 'Backup drive', 'Test bench'].forEach((mc, i) => w(`Work/Systems/Machines/${mc}.md`, `---\ntype: machine\nkind: Server\nstatus: Live\nos: Debian 12\n---\n# ${mc}\n`));
    ['Nightly backup', 'Shop website', 'Till sync', 'Photo archive', 'VPN', 'Print queue', 'File share', 'Uptime checks'].forEach((sv, i) => w(`Work/Systems/Services/${sv}.md`, `---\ntype: service\nstatus: Live\nmachine: "[[Office server]]"\n---\n# ${sv}\n`));
    await H2.services.rescanAll();
    for (let i = 0; i < 18; i++) await H2.services.invoke('health:put', ['appointments', { id: `a${i}`, day: D(-160 + i * 12), who: ['GP check-up', 'Physio', 'Dentist', 'Optometrist', 'Physio review', 'Skin check'][i % 6], status: i < 14 ? 'done' : 'booked', results: [] }]);
    await H2.browser.send('Page.navigate', { url: `${H2.origin}/harness.html` });
    assert.ok(await waitFor(H2, `!!document.querySelector('.app')`, 45000), 'the app boots');
    await sleep(2500);
  }
  return H2;
}
after(async () => {
  try { rmSync(H2FOLDER, { recursive: true, force: true }); } catch {}
  await H2?.close().catch(() => {});
  H2 = null;
});

async function openProject2(h, name) {
  await openRoom(h, 'Projects');
  assert.equal(await clickWords(h, name, 'main'), 'CLICKED', `${name} opens`);
  assert.ok(await waitFor(h, `!!document.querySelector('.pj-page')`, 15000), 'the page lands');
  await sleep(2000);
}
async function openTab2(h, id) {
  await h.browser.ev(`document.querySelector('[data-tab="${id}"]')?.click()`);
  await sleep(1000);
}
// A pack room, by its palette row (a type page can share its name: the pack row reads "Pack").
async function openPack(h, label) {
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75 });
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75 });
  await sleep(500);
  assert.ok(await waitFor(h, `!!document.querySelector('.picker input')`, 5000), 'the palette opens');
  await h.browser.send('Input.insertText', { text: label });
  await sleep(900);
  const r = await h.browser.ev(`(() => {
    const rows = [...document.querySelectorAll('.picker-row')];
    const row = rows.find((x) => (x.querySelector('.picker-label')?.innerText || '').trim() === '${label}' && (x.querySelector('.picker-detail')?.innerText || '').trim() === 'Pack');
    if (!row) return 'NOTFOUND';
    row.scrollIntoView({ block: 'nearest' });
    row.click();
    return 'CLICKED';
  })()`);
  assert.equal(r, 'CLICKED', `${label} opens from the palette`);
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await sleep(1500);
}

test('t261 money: a year of real-shaped bills, counted, due-first, mark-paid works', { timeout: 300000 }, async () => {
  const h = await harness2();
  await h.browser.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1117, deviceScaleFactor: 1, mobile: false });
  await openProject2(h, 'Harbour Festival Build');
  const badge = await h.browser.ev(`document.querySelector('[data-tab="money"] .pt-count')?.innerText ?? null`);
  assert.equal(badge, '15', 'the Money tab counts its 15 bills');
  await openTab2(h, 'money');
  // The bill rows (the head row carries no bill): the count equals its rows (t249).
  const bills = await h.browser.ev(`[...document.querySelectorAll('[data-section="money"] [data-item-card="money"] .trow button.t')].map((b) => (b.textContent || '').trim())`);
  assert.equal(bills.length, 15, 'fifteen bill rows stand');
  assert.ok(bills.includes('Wharf Power') && bills.includes('Cleaning Crew'), 'first to last of the year');
  const head = await h.browser.ev(`(document.querySelector('[data-section="money"] [data-item-card="money"] .trow .meta')?.innerText || '').replace(/\\s+/g, ' ')`);
  assert.ok(/still due/.test(head) && /a month/.test(head), `due first with the monthly figure (${head})`);
  const kinds = await h.browser.ev(`(document.querySelector('[data-section="money"]')?.innerText || '')`);
  assert.ok(kinds.includes('monthly') && kinds.includes('quarterly') && kinds.includes('yearly'), 'cycles read as written');
  assert.ok(kinds.includes('Autopay'), 'autopay reads where set');
  assert.ok(kinds.includes('Paid and paused'), 'the paid rest folds below');
  // Marking one paid here marks it paid everywhere (its own tick; the row reads just paid with its
  // next day, never vanished — the F3 rule the Bills page, Today and Home share).
  const tick = await h.browser.ev(`(() => {
    const b = [...document.querySelectorAll('[data-section="money"] button.check')].find((x) => (x.getAttribute('aria-label') || '').startsWith('Mark '));
    if (!b) return null;
    b.click();
    return b.getAttribute('aria-label');
  })()`);
  assert.ok(tick, 'a bill stands payable to tick');
  assert.ok(await waitFor(h, `(document.querySelector('[data-section="money"]')?.innerText || '').includes('Paid · next')`, 10000), 'the row reads just paid with its next day');
});

test('t261 updates: an agent delivery reads as a row, both buttons working', { timeout: 300000 }, async () => {
  const h = await harness2();
  await h.browser.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1117, deviceScaleFactor: 1, mobile: false });
  await openProject2(h, 'Harbour Festival Build');
  const badge = await h.browser.ev(`document.querySelector('[data-tab="updates"] .pt-count')?.innerText ?? null`);
  assert.equal(badge, '7', 'six updates plus the delivery');
  await openTab2(h, 'updates');
  const row = await h.browser.ev(`(() => {
    const box = document.querySelector('[aria-label="Delivered by agents"]');
    if (!box) return null;
    const r = box.querySelector('.trow').getBoundingClientRect();
    return { words: box.innerText.replace(/\\s+/g, ' '), h: Math.round(r.height), btns: [...box.querySelectorAll('button')].map((b) => (b.innerText || '').replace(/\\s+/g, ' ').trim()) };
  })()`);
  assert.ok(row, 'the delivery stands');
  assert.ok(row.words.includes('Closeout report.pdf'), 'its name');
  assert.ok(row.words.includes('The closeout summary for the build'), 'the agent’s one line');
  assert.ok(row.words.includes('PDF') && row.words.includes('Chief delivered it to Harbour Festival Build'), 'kind, size, who, where, when');
  assert.ok(row.h < 72, `as compact as the page’s other rows (${row.h}px)`);
  assert.ok(row.btns.includes('Open') && row.btns.some((b) => b.includes('Show in folder')), `both buttons stand (${row.btns.join(' | ')})`);
  // Open: the file itself in the folder viewer, never as gone.
  await h.browser.ev(`[...document.querySelectorAll('[aria-label="Delivered by agents"] button')].find((b) => (b.innerText || '').trim() === 'Open')?.click()`);
  assert.ok(await waitFor(h, `!!document.querySelector('.media-view, .pf-view-pdf, .pdfv')`, 10000), 'the viewer lands');
  const seen = await h.browser.ev(`(() => ({ failed: !!document.querySelector('.pdfv-failed'), frame: document.querySelector('.pf-view-pdf')?.getAttribute('src') ?? null }))()`);
  assert.equal(seen.failed, false, 'never as gone');
  assert.ok(seen.frame && decodeURIComponent(seen.frame).includes('Delivered/Closeout report.pdf'), `its own file (${seen.frame})`);
  // Show in folder: revealed where it sits (the harness records the reveal, as no Explorer opens headless).
  await h.browser.ev(`document.querySelector('button[aria-label="Back"]')?.click()`);
  assert.ok(await waitFor(h, `!!document.querySelector('.pj-page')`, 15000), 'Back returns to the project');
  await sleep(1500);
  await openTab2(h, 'updates');
  const n0 = h.services.opened.length;
  await h.browser.ev(`[...document.querySelectorAll('[aria-label="Delivered by agents"] button')].find((b) => (b.innerText || '').includes('Show in folder'))?.click()`);
  await sleep(800);
  assert.ok(h.services.opened.slice(n0).some((o) => o.what === 'shown' && o.file === 'Delivered/Closeout report.pdf'), 'the file is shown in its folder');
});

test('t261 long project: 200 steps and 60 files stay instant, Find narrows, Back restores', { timeout: 300000 }, async () => {
  const h = await harness2();
  await h.browser.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1117, deviceScaleFactor: 1, mobile: false });
  await openProject2(h, 'Long Haul Refit');
  assert.equal(await h.browser.ev(`document.querySelector('[data-tab="whats-next"] .pt-count')?.innerText ?? null`), '200', '200 steps counted');
  assert.equal(await h.browser.ev(`document.querySelector('[data-tab="notes"] .pt-count')?.innerText ?? null`), '61', '60 files plus the delivery counted');
  await openTab2(h, 'whats-next');
  // The switch stays instant on the full tab: selected and painted, no reload.
  const t0 = Date.now();
  await h.browser.ev(`document.querySelector('[data-tab="notes"]')?.click()`);
  assert.ok(await waitFor(h, `document.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute('data-tab') === 'notes' && [...document.querySelectorAll('[role="tabpanel"]')].find((el) => el.id === 'pj-panel-notes')?.getClientRects().length > 0`, 8000), 'the Notes tab lands');
  const ms = Date.now() - t0;
  assert.ok(ms < 1500, `the switch stays instant (${ms}ms on 200 steps and 60 files)`);
  await openTab2(h, 'whats-next');
  // The long tab earns its Find; the Find narrows where it stands.
  assert.ok(await waitFor(h, `!!document.querySelector('#pj-panel-whats-next input[aria-label="Find in this list"]')`, 8000), 'the 200-row tab earns a Find');
  await h.browser.ev(`document.querySelector('#pj-panel-whats-next input[aria-label="Find in this list"]')?.focus()`);
  await h.browser.send('Input.insertText', { text: 'haul task number 150' });
  await sleep(800);
  const found = await h.browser.ev(`(() => ({
    rows: [...document.querySelectorAll('#pj-panel-whats-next [data-item^="next:"]')].filter((el) => el.getClientRects().length > 0).length,
    n: document.querySelector('#pj-panel-whats-next .pt-find-n')?.innerText ?? '',
  }))()`);
  assert.equal(found.rows, 1, 'the Find filters to its row');
  assert.equal(found.n, '1 of 202', 'naming what it shows (the Find searches Done too)');
  // Back restores the tab and its scroll, the Find standing as left.
  await h.browser.ev(`document.querySelector('#pj-panel-whats-next .pt-find-x')?.click()`);
  await sleep(600);
  await h.browser.ev(`document.querySelector('.vscroll').scrollTo({ top: 600 })`);
  await sleep(500);
  await openTab2(h, 'people');
  await h.browser.ev(`document.querySelector('button[aria-label="Back"]')?.click()`);
  await sleep(1200);
  assert.equal(await h.browser.ev(`document.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute('data-tab')`), 'whats-next', 'Back returns to Your next');
  const top = await h.browser.ev(`document.querySelector('.vscroll').scrollTop`);
  assert.ok(Math.abs(top - 600) < 60, `its scroll stands (${Math.round(top)}px on 200 rows)`);
});

test('t261 rooms: on a made-up vault of realistic size, no room runs past about two screens', { timeout: 300000 }, async () => {
  const h = await harness2();
  await h.browser.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1117, deviceScaleFactor: 1, mobile: false });
  const ratio = async () => {
    await sleep(1500);
    return h.browser.ev(`(() => {
      const sc = document.querySelector('main')?.closest('.vscroll, .nv-page-scroll') ?? document.querySelector('.vscroll, .nv-page-scroll') ?? document.querySelector('main');
      return Math.round(sc.scrollHeight) / Math.max(1, Math.round(sc.clientHeight));
    })()`);
  };
  // Today stays one page: Late, Next and Also fold, never endless.
  await openRoom(h, 'Today');
  assert.ok(await ratio() <= 1.5, 'Today stays one page');
  // Projects home, one list under its filters: chips and Find, not tabs.
  await openRoom(h, 'Projects');
  assert.ok(await ratio() <= 2.1, 'Projects home never runs endless');
  assert.ok(await h.browser.ev(`!!document.querySelector('main input[aria-label="Find a project"]')`), 'with its Find');
  // The Meetings room: Upcoming, Past and the record lists behind chips.
  await openRoom(h, 'Meetings');
  assert.ok(await ratio() <= 1.5, 'Meetings lands on one screen');
  assert.ok((await h.browser.ev(`[...document.querySelectorAll('main [role="tab"]')].map((e) => (e.innerText || '').trim()).join(',')`)).includes('Every action'), 'its chips stand');
  // Tasks, one list: chips and Find, not tabs.
  await openRoom(h, 'Tasks');
  assert.ok(await h.browser.ev(`!!document.querySelector('main input[aria-label="Find in this list"]')`), 'Tasks keeps its Find (t262: the shared words)');
  // More's rooms, each on one screen or so: Money, Health, Goals, Systems, Sites, House, Trips.
  await openPack(h, 'Money');
  assert.ok(await ratio() <= 1.5, 'Money lands on one screen');
  assert.equal(await clickWords(h, 'More for Money', 'main'), 'CLICKED', 'Money’s menu opens');
  assert.equal(await h.browser.ev(`(() => { const el = [...document.querySelectorAll('.menu [role="menuitem"], .menu button')].find((e) => (e.innerText || '').trim() === 'Bills'); if (!el) return 'NOTFOUND'; el.click(); return 'CLICKED'; })()`), 'CLICKED', 'Bills opens');
  assert.ok(await ratio() <= 2.1, 'Bills never runs endless');
  await openPack(h, 'Health');
  assert.ok(await ratio() <= 1.5, 'Health lands on one screen');
  await openPack(h, 'Goals');
  assert.ok(await ratio() <= 2.1, 'Goals never runs endless');
  await openPack(h, 'Systems');
  assert.ok(await ratio() <= 2.1, 'Systems never runs endless');
  await openPack(h, 'Sites');
  assert.ok(await ratio() <= 2.1, 'Sites never runs endless');
  await openPack(h, 'House');
  assert.ok(await ratio() <= 2.1, 'House never runs endless');
  await openPack(h, 'Trips');
  assert.ok(await ratio() <= 2.1, 'Trips never runs endless');
  await openRoom(h, 'Settings');
  assert.ok(await ratio() <= 2.1, 'Settings never runs endless');
});

test('t261 head: as compact as the content, faces never touching', { timeout: 300000 }, async () => {
  const h = await harness();
  await h.browser.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1117, deviceScaleFactor: 1, mobile: false });
  await openProject(h);
  const head = await h.browser.ev(`(() => {
    const r = (s) => document.querySelector(s)?.getBoundingClientRect();
    const hero = r('.pj-page .nv-hero'), psub = r('.pj-page .nv-hero .w2a-psub');
    const faces = [...document.querySelectorAll('button.avatars.w2a-ava i')].map((el) => { const b = el.getBoundingClientRect(); return { x: b.x, w: b.width }; });
    return { heroH: Math.round(hero.height), psubH: Math.round(psub.height), bot: Math.round(hero.bottom - psub.bottom), faces };
  })()`);
  // The head stood ~180px with empty space below the summary (the hidden pencil's own line); now the
  // summary reads on one line and the card ends with it.
  assert.ok(head.psubH < 34, `the summary stands on its own line, no dead line under it (${head.psubH}px)`);
  assert.ok(head.bot <= 20, `the card ends with the summary (${head.bot}px under it)`);
  assert.ok(head.heroH <= 125, `the head is as compact as the content needs (${head.heroH}px, was ~139)`);
  // BM DL PN overlapped so the first read "BN"; now whole faces stand apart (the t208 rule, live here too).
  assert.ok(head.faces.length >= 3, 'faces stand to judge');
  for (let i = 1; i < head.faces.length; i++) {
    const pitch = head.faces[i].x - head.faces[i - 1].x;
    assert.ok(pitch >= head.faces[i].w, `faces apart, letters never touching (pitch ${Math.round(pitch)}px of ${Math.round(head.faces[i].w)}px)`);
  }
});
