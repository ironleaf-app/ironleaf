// node --test tests/t253-page-once.test.mjs — the project page reads once (t253, 13 Nov 2026, the
// three pictures of their own project pages in 10.2.6). The dashboard's Next actions and Milestones
// drew the same lists as Your next and Key dates below (faults 1-2): they step aside, presets and
// own blocks alike, and a progress checklist read from What's next keeps its figure only. Key dates
// asks about each date gone by on its own row, answered in one click (fault 2). Paired sections
// share their row and Notes and files takes the width it needs (fault 3). The status line fits its
// window (fault 7). Waiting on others keeps naming who each row is with: the cell is the row's
// reassign, so the repetition stays (fault 8). Made-up vault only. Fails without each change.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { clickWords, openRoom, sleep, waitFor } from './t152-lib.mjs';
import { startHarness } from './vault-controls-harness.mjs';

const root = path.join(import.meta.dirname, '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const D = (off) => iso(new Date(Date.now() + off * 864e5));

// ── Static: the mechanisms ──────────────────────────────────────────────

test('the dashboard steps its Your-next and Key-dates blocks aside on the folio page', () => {
  const dash = read('src/renderer/src/views/project/LayoutDashboard.tsx');
  assert.ok(dash.includes(`m.type !== 'actions'`) && dash.includes(`m.type === 'timeline' && m.source === 'dates'`),
    'actions and dates-timeline blocks step aside, presets and own blocks alike');
  assert.ok(!dash.includes('{models.map(') && dash.includes('{drawn.map('), 'the page draws the stepped-aside list');
  const phases = dash.slice(dash.indexOf('function Phases'), dash.indexOf('function Phases') + 9000);
  assert.ok(phases.includes('The steps are under Your next.'), 'a progress list of next steps keeps its figure and points on');
  assert.ok(!phases.includes('items={nextItems}'), 'never the checklist twice');
  assert.ok(read('docs/LAYOUTS.md').includes('never draws twice'), 'the contract says so');
});

test('each key date reads once, and a date gone by asks on its own row with one-click answers', () => {
  const tabs = read('src/renderer/src/views/project/ProjectTabs87.tsx');
  // t255: the split lives in keyDatesModel (Key dates and the Overview read the one split, each date once in both).
  const model = tabs.slice(tabs.indexOf('export function keyDatesModel'), tabs.indexOf('export function openRisksRanked'));
  assert.ok(model.includes('asked: miles.filter'), 'the gone-by dates read as their own rows');
  assert.ok(model.includes('!wentBy.has(itemKey(m.ref))'), 'coming and Past exclude them: each date reads once');
  const sec = tabs.slice(tabs.indexOf('export function KeyDatesSection'));
  assert.ok(sec.includes('keyDatesModel(p, ctx.hub, today)'), 'Key dates reads the one split');
  assert.ok(sec.includes('went by. Did it happen?'), 'the nudge stays');
  const ask = tabs.slice(tabs.indexOf('function WentByAsk'), tabs.indexOf('function WentByAsk') + 2000);
  assert.ok(ask.includes('Did it happen?') && ask.includes('It happened') && ask.includes('Not yet'), 'the row asks, answered in one click');
  assert.ok(ask.includes(`{ status: 'Happened' }`), 'It happened marks it done');
  assert.ok(ask.includes('{ when: isoDay(today) }'), 'Not yet moves it to today, still open');
  assert.ok(read('src/renderer/src/styles/w2a.css').includes('.pj-ask {'), 'the question sits with the row');
});

test('tabs stand alone at full width; no pairing strands a section (t255: the tabs replace the pairing, t253 fault 3 and the fourth picture)', () => {
  const css = read('src/renderer/src/styles/w2a.css');
  assert.ok(css.includes('.vpage.wide.pj-folio.is-tabs { display: block; }'), 'each tab reads at the page’s full width: one list, no side columns, no section waits for its neighbour');
  assert.ok(css.includes('.pj-stickhead { position: sticky; top: 0;'), 'the head stays fixed above the tabs');
  assert.ok(css.includes('.pj-ov { display: grid'), 'the Overview shares the width in columns of its own');
});

test('Waiting on others keeps naming who each row is with (fault 8: needed, kept)', () => {
  // Each row's who cell is the row's reassign: it edits where it shows, through the line it came from.
  // The head names the person; the cell keeps the name so the row still offers its change. t249 pinned it.
  const tabs = read('src/renderer/src/views/project/ProjectTabs87.tsx');
  const row = tabs.slice(tabs.indexOf('function WaitingRow'), tabs.indexOf('function WaitingRow') + 4000);
  assert.ok(row.includes('<WhoInner name={a.person || a.who} />'), 'every name shows, no hiding');
  assert.ok(!row.includes('visibleWho'), 'never hidden as your own: nobody here is you');
  assert.ok(row.includes('saveAction(a, { who: v })'), 'the cell reassigns the row');
});

// ── Live: one boot, a small programme and a big plain folio ─────────────

const SMALL = 'Projects/Harbour Light Launch/Harbour Light Launch.md';
const BIG = 'Projects/Harbour Festival Build/Harbour Festival Build.md';
let H = null;
async function harness() {
  if (!H) {
    H = await startHarness();
    await H.services.invoke('settings:update', [{ prefs: { modules: { meetings: { on: true } }, statusLine: true } }]);
    const w = (rel, text) => {
      const p = path.join(H.vaultDir, ...rel.split('/'));
      mkdirSync(path.dirname(p), { recursive: true });
      writeFileSync(p, text);
    };
    w(SMALL, `---\ntype: project\nstatus: active\nhealth: on track\nowner: Alex Chen\ndue: ${D(7)}\nlayout: programme\n---\n# Harbour Light Launch\n\n## Summary\n\nThe November launch for the harbour traders.\n\n## What's next\n\n- [ ] Present the November deck at the traders meeting — Alex Chen — due ${D(-1)}\n- [ ] Ask the group to agree the close date — Alex Chen — due ${D(-1)}\n- [ ] December edition outcome — Alex Chen\n\n## Key dates\n\n| Date | Milestone | Status |\n|---|---|---|\n| ${D(-15)} | October edition presented | Done |\n| ${D(-1)} | November edition, traders meeting | Planned |\n\n## People\n\n- Alex Chen\n\n## Decisions\n\n- ${D(-10)}: Hold the launch on the north wharf\n\n## Notes\n\nKept for the launch.\n`);
    const jobs = Array.from({ length: 12 }, (_, i) => `Job number ${i + 1} for the festival build`);
    const steps = jobs.map((j, i) => `- [ ] ${j} — Alex Chen — due ${D([-3, -1, 0, 2][i % 4])}`).join('\n');
    w(BIG, `---\ntype: project\nstatus: active\nhealth: at risk\nowner: Alex Chen\ndue: ${D(14)}\n---\n# Harbour Festival Build\n\n## Summary\n\nThe summer festival build across the north wharf.\n\n## What's next\n\n${steps}\n- [ ] Clarify the north wording — Bettina Maddox\n- [ ] Align on cover — Darcy Lin\n\n## Key dates\n\n| Date | Milestone | Status |\n|---|---|---|\n| ${D(-20)} | Stalls booked | Done |\n| ${D(-1)} | Lighting check with the crew | Planned |\n| ${D(0)} | Team check-in |  |\n| ${D(2)} | Rooms confirmed |  |\n\n## People\n\n- Alex Chen\n- Bettina Maddox — Copy lead writing the festival summary\n- Darcy Lin — Cafe manager covering the roster gaps\n\n## Decisions\n\n- ${D(-12)}: Open on the north wharf\n\n## Risks\n\n- The card reader fails again on a busy Saturday (owner: Alex Chen, level: high)\n- Rain on opening night (level: medium)\n\n## Updates\n\n- ${D(-1)}: Survey forms printed and stacked\n\n## Notes\n\nThe build in short.\n`);
    for (let n = 0; n < 6; n++) w(`Projects/Harbour Festival Build/Notes/Build note ${n + 1}.md`, `---\ntype: note\nproject: ${BIG}\n---\n# Build note ${n + 1}\n\nThe build notes, part ${n + 1}.\n`);
    for (let n = 0; n < 25; n++) w(`Links/Linker ${n + 1}.md`, `# Linker ${n + 1}\n\nSee [[Harbour Festival Build]] for the plan.\n`);
    await H.services.rescanAll();
    await H.browser.send('Page.navigate', { url: `${H.origin}/harness.html` });
    assert.ok(await waitFor(H, `!!document.querySelector('.app')`, 45000), 'the app boots');
    await sleep(2500);
  }
  return H;
}
before(async () => { await harness(); }, { timeout: 600000 });
after(async () => { await H?.close().catch(() => {}); H = null; });

async function openProject(h, name) {
  await openRoom(h, 'Projects');
  assert.equal(await clickWords(h, name, 'main'), 'CLICKED', `${name} opens`);
  assert.ok(await waitFor(h, `!!document.querySelector('.pj-page')`, 15000), 'the page lands');
  await sleep(1500);
}
async function size(h, W, Hg) {
  await h.browser.send('Emulation.setDeviceMetricsOverride', { width: W, height: Hg, deviceScaleFactor: 2, mobile: false });
  await sleep(900);
}
async function clickButton(h, label, scope) {
  // The row itself carries the button's words, so match buttons only, exactly.
  return h.browser.ev(`(() => {
    const root = document.querySelector(${JSON.stringify(scope)});
    if (!root) return 'NOROOT';
    const el = [...root.querySelectorAll('button')].find((e) => {
      const r = e.getBoundingClientRect();
      return r.width > 2 && r.height > 2 && (e.innerText || '').trim() === ${JSON.stringify(label)};
    });
    if (!el) return 'NOTFOUND';
    el.scrollIntoView({ block: 'nearest' });
    el.click();
    return 'CLICKED';
  })()`);
}
async function toSection(h, id) {
  // Sections past the fold skip layout until neared (content-visibility): walk there first.
  await h.browser.ev(`(() => {
    const sc = document.querySelector('.vscroll');
    const el = document.querySelector(${JSON.stringify(`[data-section="${id}"]`)});
    if (!sc || !el) return;
    sc.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - 70) });
  })()`);
  await sleep(700);
}
async function openTab(h, id) {
  // t255: the section bar became real tabs — open the tab, then walk to its rows.
  await h.browser.ev(`document.querySelector('[data-tab="${id}"]')?.click()`);
  await sleep(900);
}

test('no list draws twice: no Next-actions, Milestones or progress checklist above Your next', { timeout: 300000 }, async () => {
  const h = await harness();
  await size(h, 1920, 1117);
  await openProject(h, 'Harbour Light Launch');
  const got = await h.browser.ev(`(() => ({
    actions: document.querySelectorAll('.ly-b-actions').length,
    timelines: document.querySelectorAll('.ly-b-timeline').length,
    progChecks: document.querySelectorAll('.ly-b-progress .ly-check-words').length,
    progNote: [...document.querySelectorAll('.ly-b-progress .ly-more-note')].map((e) => e.innerText.trim()),
    next: [...document.querySelectorAll('[data-section="whats-next"] [data-item^="next:"] .tkrow-title')].map((e) => e.innerText.trim()),
  }))()`);
  assert.equal(got.actions, 0, 'no Next actions card above');
  assert.equal(got.timelines, 0, 'no Milestones block above');
  assert.equal(got.progChecks, 0, 'no progress checklist of the same steps');
  assert.deepEqual(got.progNote, ['The steps are under Your next.'], 'the progress block keeps its figure and points on');
  assert.deepEqual(got.next, ['Present the November deck at the traders meeting', 'Ask the group to agree the close date', 'December edition outcome'], 'Your next holds the three, once');
});

test('each key date reads once, asked on its own row and answered in one click', { timeout: 300000 }, async () => {
  const h = await harness();
  await size(h, 1920, 1117);
  await openProject(h, 'Harbour Light Launch');
  await openTab(h, 'key-dates');
  await toSection(h, 'key-dates');
  const keys = await h.browser.ev(`[...document.querySelectorAll('[data-section="key-dates"] [data-item^="dates:"]')].map((e) => e.getAttribute('data-item'))`);
  assert.deepEqual([...keys].sort(), ['dates:0', 'dates:1'], `each date reads once (saw ${keys})`);
  const ask = await h.browser.ev(`(() => {
    const sec = document.querySelector('[data-section="key-dates"]');
    const rows = [...sec.querySelectorAll('.trow')].map((r) => r.innerText.replace(/\\s+/g, ' '));
    return { nudge: sec.querySelector('.pj-faint')?.innerText.trim() ?? '', rows };
  })()`);
  assert.equal(ask.nudge, '1 date went by. Did it happen?', 'the nudge stays');
  assert.ok(ask.rows.some((r) => r.includes('November edition, traders meeting') && r.includes('Did it happen?') && r.includes('It happened') && r.includes('Not yet')), `the gone-by date asks on its own row (${ask.rows.join(' / ')})`);
  assert.equal(await clickButton(h, 'It happened', '[data-section="key-dates"]'), 'CLICKED', 'It happened answers in one click');
  assert.ok(await waitFor(h, `!document.querySelector('[data-section="key-dates"] .pj-ask')`, 8000), 'the question leaves with its answer');
  const after = await h.browser.ev(`(() => {
    const sec = document.querySelector('[data-section="key-dates"]');
    return { nudge: sec.querySelector('.pj-faint')?.innerText.trim() ?? null, past: sec.querySelector('details.tkdone summary')?.innerText.replace(/\\s+/g, ' ') ?? null };
  })()`);
  assert.equal(after.nudge, null, 'nothing left to ask about');
  assert.equal(after.past, 'Past 2', 'both dates rest in Past now');
});

test('Not yet moves the date to today, still open', { timeout: 300000 }, async () => {
  const h = await harness();
  await size(h, 1920, 1117);
  await openProject(h, 'Harbour Festival Build');
  await openTab(h, 'key-dates');
  await toSection(h, 'key-dates');
  const before = await h.browser.ev(`document.querySelector('[data-section="key-dates"] .pj-faint')?.innerText.trim() ?? ''`);
  assert.equal(before, '1 date went by. Did it happen?', 'a date waits to be answered');
  assert.equal(await clickButton(h, 'Not yet', '[data-section="key-dates"]'), 'CLICKED', 'Not yet answers in one click');
  assert.ok(await waitFor(h, `!document.querySelector('[data-section="key-dates"] .pj-ask')`, 8000), 'the question leaves');
  const rows = await h.browser.ev(`[...document.querySelectorAll('[data-section="key-dates"] .trow')].map((r) => r.innerText.replace(/\\s+/g, ' '))`);
  assert.ok(rows.some((r) => r.startsWith('Today Lighting check with the crew')), `the date reads in coming as today (${rows.join(' / ')})`);
});

test('every tab reads full width at every size, with no side void (t255: the tabs replace the pairing)', { timeout: 300000 }, async () => {
  const h = await harness();
  await openProject(h, 'Harbour Festival Build');
  // t255: one list per tab, never side columns — no section beside an empty half, no column waiting on its neighbour.
  const display = await h.browser.ev(`getComputedStyle(document.querySelector('.vpage.wide.pj-folio')).display`);
  assert.equal(display, 'block', 'the tabbed folio never pairs side columns');
  for (const [W, Hg] of [[3456, 1408], [1920, 1117], [1219, 709]]) {
    await size(h, W, Hg);
    const ids = ['overview', 'whats-next', 'waiting', 'questions', 'key-dates', 'notes', 'people', 'decisions', 'risks', 'chats', 'updates', 'money', 'activity'];
    for (const id of ids) {
      await openTab(h, id);
      const w = await h.browser.ev(`(() => {
        const folio = document.querySelector('.vpage.wide.pj-folio');
        const cs = getComputedStyle(folio);
        const panel = [...document.querySelectorAll('[role="tabpanel"]')].find((el) => el.getClientRects().length > 0);
        return {
          panel: Math.round(panel.getBoundingClientRect().width),
          folio: folio.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight),
        };
      })()`);
      assert.ok(Math.abs(w.panel - w.folio) < 12, `${W}: ${id} full width (${w.panel} of ${w.folio})`);
    }
  }
});

test('the status line fits its window at every size', { timeout: 300000 }, async () => {
  const h = await harness();
  await openProject(h, 'Harbour Festival Build');
  for (const [W, Hg] of [[3456, 1408], [1920, 1117], [1219, 709]]) {
    await size(h, W, Hg);
    const bar = await h.browser.ev(`(() => {
      const sb = document.querySelector('.statusbar');
      if (!sb) return null;
      const items = [...sb.querySelectorAll('.status-item, .status-licence')].map((el) => ({ text: el.innerText.trim(), right: Math.round(el.getBoundingClientRect().right) }));
      return { text: sb.innerText.replace(/\\s+/g, ' ').trim(), items, inner: window.innerWidth };
    })()`);
    assert.ok(bar && bar.items.length >= 2, `${W}: the line stands to judge (${bar?.text})`);
    for (const it of bar.items) assert.ok(it.right <= bar.inner, `${W}: "${it.text}" ends inside the window (${it.right} of ${bar.inner})`);
  }
});
