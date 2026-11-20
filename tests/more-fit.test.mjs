// node --test tests/more-fit.test.mjs — More fits exactly, never cut off (9 Nov 2026: the t66 picture at
// 1920x1117 shows "Choose packs…" cut off at the window's bottom — the fit estimate missed the menu's top
// position and its 1px border). The pure estimate stays the first guess; the real menu is measured after it
// renders and the next biggest group folds into its submenu until the menu's bottom sits 8px above the window's
// with no scroll. Live: at 1219x709, 1920x1117 and 3456x1408, with 0, 3 and 8 packs on and the vault's kinds,
// the last row's bottom never passes the window's bottom less 8px and nothing scrolls; the interface size at
// 125% (large) is covered at its CSS sizes too. Each check fails without the fix (the t66 menu runs 9–31px past).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let H = null;
async function harness() {
  if (!H) {
    const { startHarness } = await import('./vault-controls-harness.mjs');
    H = await startHarness();
    const ev = H.browser.ev;
    for (let i = 0; i < 90; i++) {
      await sleep(500);
      try {
        if (await ev(`!!document.querySelector('.app')`)) break;
      } catch {}
    }
    await sleep(2200);
  }
  return H;
}
after(async () => {
  await H?.close().catch(() => undefined);
  H = null;
});

async function setPacks(h, ids) {
  const modules = {};
  for (const id of ids) modules[id] = { on: true };
  await h.services.invoke('settings:update', [{ prefs: { modules } }]);
  await h.browser.send('Page.navigate', { url: `${h.origin}/harness.html` });
  const ev = h.browser.ev;
  for (let i = 0; i < 90; i++) {
    await sleep(500);
    try {
      if (await ev(`!!document.querySelector('.app')`)) break;
    } catch {}
  }
  await sleep(2500);
}

const clickMore = (h) =>
  h.browser.ev(`(async () => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
    const els = [...document.querySelectorAll('.places-list button')].filter(vis);
    const el = els.find((e) => (e.innerText || '').includes('More'));
    if (!el) return 'NOTFOUND';
    el.click();
    await new Promise((r) => setTimeout(r, 1100));
    return 'CLICKED';
  })()`);
const key = async (h, code, k, vk) => {
  await h.browser.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: vk, key: k, code, modifiers: 0 });
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: vk, key: k, code, modifiers: 0 });
  await sleep(400);
};

async function measureMore(h) {
  return h.browser.ev(`(() => {
    const menu = document.querySelector('.menu');
    if (!menu) return { none: true, innerH: window.innerHeight };
    const r = menu.getBoundingClientRect();
    const rows = [...menu.querySelectorAll('.menu-row, .menu-heading, .menu-separator')];
    const last = rows[rows.length - 1];
    const lr = last ? last.getBoundingClientRect() : null;
    return {
      top: Math.round(r.top * 10) / 10, bottom: Math.round(r.bottom * 10) / 10,
      scrollH: menu.scrollHeight, clientH: menu.clientHeight,
      lastBottom: lr ? Math.round(lr.bottom * 10) / 10 : null,
      lastLabel: last ? (last.querySelector?.('.menu-label')?.textContent?.trim() ?? last.textContent.trim().slice(0, 40)) : null,
      innerH: window.innerHeight, innerW: window.innerWidth,
      labels: rows.map((e) => e.classList.contains('menu-heading') ? '[' + e.textContent.trim() + ']' : (e.classList.contains('menu-separator') ? '---' : e.querySelector('.menu-label')?.textContent?.trim() ?? '?')).join(' | '),
    };
  })()`);
}

async function checkFits(h, w, hgt, packWords, band = null) {
  await h.browser.send('Emulation.setDeviceMetricsOverride', { width: w, height: hgt, deviceScaleFactor: 1, mobile: false });
  await sleep(800);
  if (band !== null) await h.browser.ev(`document.documentElement.style.setProperty('--wbtn-h', ${JSON.stringify(band)})`);
  assert.equal(await clickMore(h), 'CLICKED', `More opens at ${w}x${hgt} (${packWords})`);
  await sleep(600);
  const m = await measureMore(h);
  assert.ok(!m.none, `the menu drew at ${w}x${hgt} (${packWords})`);
  assert.ok(m.lastBottom !== null && m.lastBottom <= m.innerH + 0.5, `at ${w}x${hgt} (${packWords}) the last row “${m.lastLabel}” ends at ${m.lastBottom}px inside the ${m.innerH}px window`);
  assert.ok(m.bottom <= m.innerH - 8 + 0.5, `at ${w}x${hgt} (${packWords}) the menu ends at ${m.bottom}px, 8px above the window's ${m.innerH}px (last row “${m.lastLabel}”)`);
  assert.ok(m.scrollH - m.clientH <= 1, `at ${w}x${hgt} (${packWords}) nothing scrolls (${m.scrollH - m.clientH}px over)`);
  assert.ok(m.labels.includes('Choose packs') || m.labels.includes('Packs and kinds'), `at ${w}x${hgt} (${packWords}) every row is visible or inside a submenu (${m.labels.slice(0, 160)}…)`);
  await key(h, 'Escape', 'Escape', 27);
  await sleep(400);
  return m;
}

test('live: More fits at 1219x709, 1920x1117 and 3456x1408 with 0, 3 and 8 packs on', async () => {
  const h = await harness();
  const sizes = [[1219, 709], [1920, 1117], [3456, 1408]];
  const kinds = await h.browser.ev(`(() => document.querySelector('.app') ? 'booted' : 'missing')()`);
  assert.equal(kinds, 'booted', 'the vault booted');
  // 0 packs: the quiet vault (Other kinds plus the chooser behind Packs and kinds).
  await setPacks(h, []);
  for (const [w, hgt] of sizes) await checkFits(h, w, hgt, '0 packs');
  // 3 packs on.
  await setPacks(h, ['health', 'family', 'finance']);
  for (const [w, hgt] of sizes) await checkFits(h, w, hgt, '3 packs');
  // 8 packs on with the vault's kinds (the fullest More: 8 pack rows plus Other kinds plus the chooser).
  await setPacks(h, ['health', 'family', 'finance', 'documents', 'house', 'vehicles', 'career', 'travel']);
  for (const [w, hgt] of sizes) {
    const m = await checkFits(h, w, hgt, '8 packs');
    if (m.labels.includes('[Packs and kinds]')) {
      assert.ok(m.labels.includes('Health') && m.labels.includes('Other kinds'), `at ${w}x${hgt} (8 packs) the packs and kinds show expanded`);
    } else {
      assert.ok(m.labels.includes('Packs and kinds'), `at ${w}x${hgt} (8 packs) the packs and kinds ride folded in their submenu`);
    }
  }
  assert.deepEqual(await h.browser.ev(`window.__nvErrors`), [], 'no page errors');
});

test('live: More fits with the interface size at 125% (large)', async () => {
  // A zoom is a smaller CSS window (125% on 1219x709 is 975x567 CSS px); the measured loop reads CSS px, so
  // proving the CSS sizes proves large. 8 packs on, the fullest More, at each large size. Headless has no
  // window overlay, so its band measures the header (56px); real Windows reports about 40px, set here — with
  // the headless band even the shortest menu cannot fit 567px with an 8px margin, while 40px leaves 10px.
  const h = await harness();
  await setPacks(h, ['health', 'family', 'finance', 'documents', 'house', 'vehicles', 'career', 'travel']);
  for (const [w, hgt, words] of [[975, 567, '1219x709 at 125%'], [1536, 894, '1920x1117 at 125%'], [2764, 1126, '3456x1408 at 125%']]) {
    await checkFits(h, w, hgt, `8 packs, large (${words})`, '40px');
  }
  assert.deepEqual(await h.browser.ev(`window.__nvErrors`), [], 'no page errors');
});
