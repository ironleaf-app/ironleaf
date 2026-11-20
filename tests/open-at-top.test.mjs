// node --test tests/open-at-top.test.mjs — where a page opens (v9, 6 Nov 2026, word for word). A fresh open
// starts at the top with the title in view, every time, even for a page visited before; with tabs (t255)
// Back and returning to an open tab restore the tab and its scroll (t265), and a link to a section opens its
// tab. Fails without each change.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { openSettings, startHarness } from './vault-controls-harness.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let H = null;
after(async () => {
  if (H) await H.close().catch(() => {});
  H = null;
});
async function harness() {
  if (!H) {
    H = await startHarness();
    for (let i = 0; i < 90; i++) {
      await sleep(500);
      try {
        if (await H.browser.ev(`!!document.querySelector('.app')`)) break;
      } catch {}
    }
    await sleep(2200);
  }
  return H;
}

async function waitFor(h, js, ms = 15000) {
  const t0 = Date.now();
  for (;;) {
    try {
      if (await h.browser.ev(js)) return true;
    } catch {}
    if (Date.now() - t0 > ms) return false;
    await sleep(400);
  }
}

async function clickWords(h, words, scope = '') {
  return h.browser.ev(`(async () => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
    const root = ${scope ? `document.querySelector(${JSON.stringify(scope)})` : 'document'};
    if (!root) return 'NOROOT';
    const els = [...root.querySelectorAll('button, a[href], [role="button"], [role="tab"], summary')].filter(vis);
    const el = els.find((e) => ((e.innerText || e.getAttribute('aria-label') || e.title || '').replace(/\\s+/g, ' ').includes(${JSON.stringify(words)})));
    if (!el) return 'NOTFOUND';
    el.scrollIntoView({ block: 'nearest' });
    el.click();
    await new Promise((r) => setTimeout(r, 400));
    return 'CLICKED';
  })()`);
}

const H1 = (t) => `(document.querySelector('main h1, .main h1')?.innerText ?? '').includes(${JSON.stringify(t)})`;

async function openTestProject(h) {
  assert.equal(await clickWords(h, 'Projects'), 'CLICKED', 'Projects opens');
  assert.ok(await waitFor(h, H1('Projects')), 'the Projects home lands');
  // The heading lands before the list fills on a busy machine: wait for the row itself.
  await waitFor(h, `(document.querySelector('main')?.innerText ?? '').includes('Harbourline Cart Fix')`);
  assert.equal(await clickWords(h, 'Harbourline Cart Fix'), 'CLICKED', 'the project opens');
  assert.ok(await waitFor(h, `!!document.querySelector('.pj-page')`), 'the project page lands');
  await sleep(1200);
}

/** The page scroller's position and whether the title is in view. */
async function openState(h) {
  return JSON.parse(
    await h.browser.ev(`(() => {
      const sc = document.querySelector('.pj-page')?.closest('.vscroll');
      const h1 = document.querySelector('.pj-page h1')?.getBoundingClientRect();
      return JSON.stringify({ top: sc ? Math.round(sc.scrollTop) : -1, h1Top: h1 ? Math.round(h1.top) : -1, h1In: h1 ? h1.top >= 0 && h1.top < innerHeight : false });
    })()`),
  );
}

test('a fresh open starts at the top, even for a project visited before', async () => {
  const h = await harness();
  await h.freshView();
  await openTestProject(h);
  // Visit a section (the page remembers it), leave, and open the project fresh again.
  assert.equal(await clickWords(h, 'Key dates', 'main'), 'CLICKED', 'Key dates is on the section line');
  await sleep(900);
  assert.equal(await clickWords(h, 'Projects'), 'CLICKED', 'back to the Projects home');
  assert.ok(await waitFor(h, H1('Projects')), 'the Projects home lands');
  assert.equal(await clickWords(h, 'Harbourline Cart Fix'), 'CLICKED', 'the project opens fresh');
  assert.ok(await waitFor(h, `!!document.querySelector('.pj-page')`), 'the project page lands');
  await sleep(3000);
  const s = await openState(h);
  assert.ok(s.top <= 2, `a fresh open starts at the top (saw scrollTop ${s.top})`);
  assert.ok(s.h1In, `the title is in view (saw h1 at ${s.h1Top})`);
});

test('Back restores where the person was', async () => {
  // With tabs (t265): Back across pages restores the tab and its scroll. At 1219x709 the Notes tab runs
  // past one screen, so it scrolls first.
  const h = await harness();
  await h.browser.send('Emulation.setDeviceMetricsOverride', { width: 1219, height: 709, deviceScaleFactor: 1, mobile: false });
  await h.freshView();
  await openTestProject(h);
  await h.browser.ev(`document.querySelector('[data-tab="notes"]')?.click()`);
  await sleep(900);
  await h.browser.ev(`document.querySelector('.vscroll').scrollTo({ top: 300 })`);
  await sleep(500);
  const was = (await openState(h)).top;
  assert.ok(was > 100, `the tab scrolled down first (saw ${was})`);
  assert.equal(await clickWords(h, 'Tasks'), 'CLICKED', 'Tasks opens in the tab');
  assert.ok(await waitFor(h, H1('Tasks'), 30000), 'Tasks lands');
  const clickBack = () => h.browser.ev(`(() => { const b = document.querySelector('button[aria-label="Back"]:not([disabled])'); if (!b) return 'NOBACK'; b.click(); return 'BACK'; })()`);
  assert.equal(await clickBack(), 'BACK', 'Back is there and enabled');
  let ok = await waitFor(h, `!!document.querySelector('.pj-page')`, 10000);
  if (!ok) {
    // Still on Tasks (the click was swallowed): Back once more, never twice (that overshoots to Projects).
    const still = await h.browser.ev(H1('Tasks'));
    if (still) await clickBack();
    ok = await waitFor(h, `!!document.querySelector('.pj-page')`, 20000);
  }
  const where = await h.browser.ev(`(() => {
    const h1 = (document.querySelector('main h1, .main h1')?.innerText ?? 'none').slice(0, 60);
    return JSON.stringify({ h1, pj: !!document.querySelector('.pj-page'), app: !!document.querySelector('.app'), body: (document.body.innerText ?? '').replace(/\\s+/g, ' ').slice(0, 160) });
  })()`);
  assert.ok(ok, `Back returns to the project (saw ${where})`);
  await sleep(1500);
  const tab = await h.browser.ev(`document.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute('data-tab')`);
  assert.equal(tab, 'notes', 'Back restores the tab');
  const s = await openState(h);
  assert.ok(Math.abs(s.top - was) <= 60, `Back restores the tab's scroll (was ${was}, saw ${s.top})`);
});

test('returning to an open tab restores it', async () => {
  const h = await harness();
  await h.freshView();
  // Tabs on first (Settings › Look › Open pages in tabs), the way a person does: one page shows at a time until then.
  assert.equal(await openSettings(h), 'CLICKED', 'Settings opens');
  assert.ok(await waitFor(h, `!!document.querySelector('main')`, 30000), 'Settings lands');
  await sleep(800);
  assert.equal(await clickWords(h, 'Look', 'main'), 'CLICKED', 'Look opens');
  await sleep(800);
  const tabsOn = await h.browser.ev(`(() => {
    const el = document.querySelector('input.switch[aria-label="Open pages in tabs"]');
    if (!el) return 'missing';
    el.scrollIntoView({ block: 'nearest' });
    if (!el.checked) el.click();
    return 'on';
  })()`);
  assert.equal(tabsOn, 'on', 'tabs switch on');
  await sleep(800);
  await h.browser.send('Emulation.setDeviceMetricsOverride', { width: 1219, height: 709, deviceScaleFactor: 1, mobile: false });
  await openTestProject(h);
  // With tabs (t265): the window tab restores the page tab and its scroll. The Notes tab scrolls at 1219x709.
  await h.browser.ev(`document.querySelector('[data-tab="notes"]')?.click()`);
  await sleep(900);
  await h.browser.ev(`document.querySelector('.vscroll').scrollTo({ top: 300 })`);
  await sleep(500);
  const was = (await openState(h)).top;
  assert.ok(was > 100, `the tab scrolled down first (saw ${was})`);
  // A second tab, then back to the first.
  const plus = await h.browser.ev(`(() => { const b = document.querySelector('.tab-strip .tab-new'); if (!b || !b.getBoundingClientRect().width) return 'NOPLUS'; b.click(); return 'NEWTAB'; })()`);
  assert.equal(plus, 'NEWTAB', 'a second tab opens');
  await sleep(1000);
  const back = await h.browser.ev(`(() => {
    const items = [...document.querySelectorAll('.tab-item')].filter((e) => e.getBoundingClientRect().width > 2);
    const first = items.find((e) => (e.innerText || '').includes('Harbourline'));
    if (!first) return 'NOTAB';
    // Tabs activate on mousedown, like a person's press.
    first.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
    return 'TAB';
  })()`);
  assert.equal(back, 'TAB', 'the project tab is back');
  const reshown = await waitFor(h, `!!document.querySelector('.pj-page')`, 30000);
  const whereC = await h.browser.ev(`(() => {
    const h1 = (document.querySelector('main h1, .main h1')?.innerText ?? 'none').slice(0, 60);
    return JSON.stringify({ h1, pj: !!document.querySelector('.pj-page'), tabs: [...document.querySelectorAll('.tab-item')].map((e) => (e.innerText || '').replace(/\\s+/g, ' ').slice(0, 40)).join('|') });
  })()`);
  assert.ok(reshown, `the project page shows again (saw ${whereC})`);
  await sleep(1500);
  const retab = await h.browser.ev(`document.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute('data-tab')`);
  assert.equal(retab, 'notes', 'the window tab restores the page tab');
  const s = await openState(h);
  assert.ok(Math.abs(s.top - was) <= 60, `the window tab restores the scroll (was ${was}, saw ${s.top})`);
});

test('a link to a section goes there', async () => {
  // With tabs (t265): a link to a section opens its tab — from the bar, and from the palette's Go to.
  // (An opened item lands on its tab with its row flashing: the tabs suite walks that live.)
  const h = await harness();
  await h.freshView();
  await openTestProject(h);
  assert.equal(await clickWords(h, 'Key dates', 'main'), 'CLICKED', 'Key dates is on the tab bar');
  await sleep(900);
  assert.equal(await h.browser.ev(`document.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute('data-tab')`), 'key-dates', 'the bar opens its tab');
  const shown = await h.browser.ev(`(() => { const p = document.querySelector('#pj-panel-key-dates'); const r = p?.getBoundingClientRect(); return p && r.height > 100 ? (p.innerText ?? '').slice(0, 80) : null; })()`);
  assert.ok(shown && shown.includes('Key dates'), `its panel shows with its rows (saw ${JSON.stringify(shown)})`);
  // The palette's Go to is a link too: Go to People opens People.
  await h.browser.ev(`document.querySelector('[data-tab="overview"]')?.click()`);
  await sleep(800);
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75 });
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75 });
  assert.ok(await waitFor(h, `!!document.querySelector('.picker input')`, 5000), 'the palette opens');
  await h.browser.send('Input.insertText', { text: 'Go to People' });
  await sleep(900);
  const picked = await h.browser.ev(`(() => { const row = [...document.querySelectorAll('.picker-row')].find((x) => (x.querySelector('.picker-label')?.innerText || '') === 'Go to People'); if (!row) return 'NOTFOUND'; row.click(); return 'CLICKED'; })()`);
  assert.equal(picked, 'CLICKED', 'Go to People answers');
  await sleep(1200);
  assert.equal(await h.browser.ev(`document.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute('data-tab')`), 'people', 'picking it opens the tab');
});
