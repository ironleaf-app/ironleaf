// node --test tests/rings-names-clear.test.mjs - Rings area names never hide under the graph's own controls
// (9 Nov 2026, the shot: the Health area name sat under the "Find a note" box and read "Hea"). Area names
// and note names treat the find box, the legend and the view buttons as already taken, the way the living
// graph's names treat the legend; an area name that would collide moves along its lobe's edge to the
// nearest clear spot and every area always shows its name. Live on a made-up vault of realistic size (145 notes,
// Health the smallest area near the top) at 1323x880, 1920x1117 and 3456x1408.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let H = null;
async function harness() {
  if (!H) {
    const { startHarness } = await import('./vault-controls-harness.mjs');
    H = await startHarness();
  }
  return H;
}
after(async () => {
  await H?.close().catch(() => undefined);
  H = null;
});

// A made-up made-up vault of realistic size: 145 notes, Work 57, Me 47, Business 14, Publications 12, Home 10,
// Health 5 (the smallest area, near the top in Rings). Health's five all link; about twenty others stay
// deliberately unlinked, like their loose thoughts.
function writeVault145(dir, now = Date.now()) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  let seed = 20261109;
  const rnd = (n) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % n;
  };
  const topics = {
    Work: ['Cart retry run', 'Receipts review', 'Roster gap cover', 'Supplier call notes', 'Till roll order', 'Awning quote compare', 'Menu print proof', 'Till outage log', 'Delivery run sheet', 'Price board update', 'Staff keys handover', 'Fridge alarm check', 'Council permit chase', 'Bin roster swap'],
    Me: ['Morning walk route', 'Read list winter', 'Yoga pass renewal', 'Dentist booking', 'Library holds pickup', 'Journal entry', 'Guitar practice log', 'Sleep log review', 'Vitamin order', 'Bike service receipt', 'Photo sort batch', 'Letter to Mum draft'],
    Business: ['Winter menu costing', 'Catering quote followup', 'Lease renewal terms', 'Insurance checkup', 'Bean supplier tasting', 'Loyalty cards reorder'],
    Publications: ['Southerly recipe test', 'Winter bake notes', 'Market stall flyer draft', 'Preserves label proof'],
    Home: ['Gutter clean booking', 'Spare bulbs stock', 'Pantry stocktake', 'Fuse box map update'],
    Health: ['Physio plan review', 'Script refill reminder', 'Swim pass renewal', 'Walking group signup', 'Sleep clinic referral'],
  };
  const plan = [['Work', 57], ['Me', 47], ['Business', 14], ['Publications', 12], ['Home', 10], ['Health', 5]];
  const ids = [];
  const titles = new Map();
  for (const [area, n] of plan) {
    for (let i = 0; i < n; i++) {
      const base = `${topics[area][i % topics[area].length]} ${i + 1}`;
      const id = `${area}/${base}.md`;
      ids.push(id);
      titles.set(id, base);
    }
  }
  const byArea = (a) => ids.filter((id) => id.startsWith(`${a}/`));
  // Twenty strays across the big areas, never Health: loose thoughts.
  const loose = [
    ...byArea('Work').slice(3, 9), ...byArea('Me').slice(5, 11),
    ...byArea('Home').slice(2, 4), ...byArea('Business').slice(4, 6),
    ...byArea('Publications').slice(6, 8),
  ].slice(0, 20);
  const looseSet = new Set(loose);
  const w = (rel, text, ageDays) => {
    const p = path.join(dir, ...rel.split('/'));
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, text);
    const t = new Date(now - ageDays * 86400000);
    try { utimesSync(p, t, t); } catch {}
  };
  for (const id of ids) {
    const area = id.slice(0, id.indexOf('/'));
    const title = titles.get(id);
    const age = rnd(30);
    if (looseSet.has(id)) {
      w(id, `# ${title}\n\nA stray note about ${title.toLowerCase()} kept aside, linked to nothing yet.\n`, age);
      continue;
    }
    const inArea = byArea(area).filter((x) => x !== id && !looseSet.has(x));
    const outs = new Set();
    for (let k = 0; k < 2 && inArea.length; k++) outs.add(inArea[rnd(inArea.length)]);
    if (id === byArea(area)[0]) for (let k = 0; k < 5 && inArea.length; k++) outs.add(inArea[rnd(inArea.length)]);
    if ((area === 'Business' || area === 'Publications' || area === 'Home' || area === 'Health') && rnd(2) === 0) {
      const work = byArea('Work').filter((x) => !looseSet.has(x));
      outs.add(work[rnd(work.length)]);
    }
    if (rnd(8) === 0) {
      const any = ids.filter((x) => x !== id && !looseSet.has(x));
      outs.add(any[rnd(any.length)]);
    }
    outs.delete(id);
    for (const o of looseSet) outs.delete(o);
    const links = [...outs].slice(0, 6).map((o) => `[[${titles.get(o)}]]`).join(', ');
    w(id, `# ${title}\n\nLinks: ${links}.\n\nKept for the ${area.toLowerCase()} lobe.\n`, age);
  }
  return { total: ids.length, loose: loose.length };
}

async function waitFor(h, js, ms = 90000) {
  const t0 = Date.now();
  for (;;) {
    try {
      if (await h.browser.ev(js)) return true;
    } catch {}
    if (Date.now() - t0 > ms) return false;
    await sleep(500);
  }
}

async function openRoom(h, name) {
  const SEL = 'button, a[href], select, input, textarea, [role="button"], [role="tab"], [role="menuitem"], summary';
  const click = (words, scope) => h.browser.ev(`(async () => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
    const root = ${scope ? `document.querySelector(${JSON.stringify(scope)})` : 'document'};
    if (!root) return 'NOROOT';
    const els = [...root.querySelectorAll(${JSON.stringify(SEL)})].filter(vis);
    const el = els.find((e) => ((e.innerText || e.getAttribute('aria-label') || e.title || '').replace(/\\s+/g, ' ').includes(${JSON.stringify(words)})));
    if (!el) return 'NOTFOUND';
    el.click();
    await new Promise((r) => setTimeout(r, 400));
    return 'CLICKED';
  })()`);
  if ((await click(name, '.sidebar.left, aside')) === 'CLICKED') return;
  assert.equal(await click('More', '.sidebar.left, aside'), 'CLICKED', `More opens for ${name}`);
  await sleep(500);
  assert.equal(await click(name, '.menu, [role="menu"]'), 'CLICKED', `${name} opens from More`);
}

const overlaps = (a, b) => Math.abs(a.x - b.x) * 2 < a.w + b.w && Math.abs(a.y - b.y) * 2 < a.h + b.h;

test('wiring: the graph boxes are measured once and the rings wedges ride with the lobes', () => {
  const engine = read('src/renderer/src/lib/brain-engine.ts');
  assert.ok(engine.includes('uiBoxesCache'), 'the find, legend and view boxes are measured once and kept, not every frame');
  assert.ok(engine.includes('uiBoxes('), 'one place reads the three boxes');
  assert.ok(engine.includes('.bg-find input') && engine.includes('.bg-legend') && engine.includes('.bg-lenses'), 'find, legend and view buttons, never a constant');
  assert.ok(/size\(\): void \{[\s\S]{0,1200}?uiBoxesCache = undefined/.test(engine), 'a new size re-measures with it');
  assert.ok(/setLayout\([\s\S]{0,2500}?uiBoxesCache = undefined/.test(engine), 'a new layout re-measures with it');
  const shared = read('src/shared/brain-graph.ts');
  assert.ok(shared.includes('wedge'), 'the rings wedge rides with its lobe, so a name slides along its own edge');
});

test('live: at 1323x880, 1920x1117 and 3456x1408 no name hides under the find, legend or views', { timeout: 600000 }, async () => {
  const h = await harness();
  await h.services.invoke('settings:update', [{ prefs: { showTabs: true } }]);
  const seed = writeVault145(h.vaultDir);
  assert.equal(seed.total, 145, 'realistic size: 145 notes');
  await h.services.rescanAll();
  await h.browser.send('Page.navigate', { url: `${h.origin}/harness.html` });
  for (let i = 0; i < 90; i++) {
    await sleep(500);
    try {
      if (await h.browser.ev(`!!document.querySelector('.app')`)) break;
    } catch {}
  }
  await sleep(2000);
  await openRoom(h, 'Graph');
  for (const [w, hgt] of [[1323, 880], [1920, 1117], [3456, 1408]]) {
    await h.browser.send('Emulation.setDeviceMetricsOverride', { width: w, height: hgt, deviceScaleFactor: 1, mobile: false });
    await sleep(1200);
    assert.ok(await waitFor(h, `window.__nvBrainGraph && window.__nvBrainGraph.snapshot().count > 100`), `the brain draws at ${w}x${hgt}`);
    assert.ok(await waitFor(h, `window.__nvBrainGraph.snapshot().framed`, 90000), `the brain frames at ${w}x${hgt}`);
    await sleep(800);
    const snap = await h.browser.ev(`window.__nvBrainGraph.snapshot()`);
    // Health the smallest area, near the top.
    const legend = await h.browser.ev(`[...document.querySelectorAll('.bg-legend .bg-row')].map((e) => ({ text: e.innerText.replace(/\\s+/g, ' ').trim(), count: e.querySelector('.bg-count')?.innerText.trim() ?? '' }))`);
    const healthRow = legend.find((t) => t.text.startsWith('Health'));
    assert.ok(healthRow, `Health rows in the legend at ${w}x${hgt} (${legend.map((l) => l.text).join(' | ')})`);
    assert.equal(Number(healthRow.count), 5, `Health holds five at ${w}x${hgt}`);
    // Every area always shows its name.
    const names = snap.lobes.map((l) => l.name).sort();
    for (const want of ['Work', 'Me', 'Business', 'Publications', 'Home', 'Health']) {
      assert.ok(names.includes(want), `at ${w}x${hgt} ${want} shows (${names.join(', ')})`);
    }
    assert.equal(snap.lobes.length, 6, `at ${w}x${hgt} all six areas show (${names.join(', ')})`);
    const health = snap.lobes.find((l) => l.name === 'Health');
    assert.ok(health.y < snap.view.h * 0.45, `at ${w}x${hgt} Health sits near the top (y=${Math.round(health.y)} of ${snap.view.h})`);
    // No area or note name box overlaps the find box, the legend or the view buttons.
    const ui = await h.browser.ev(`(() => {
      const c = document.querySelector('.bg-canvas').getBoundingClientRect();
      const box = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) return null;
        return { sel, x: r.left - c.left + r.width / 2, y: r.top - c.top + r.height / 2, w: r.width, h: r.height };
      };
      const canvas = document.createElement('canvas').getContext('2d');
      canvas.font = '600 12px system-ui, sans-serif';
      const lobes = window.__nvBrainGraph.snapshot().lobes.map((l) => {
        if (l.w && l.h) return { ...l, w: l.w, h: l.h };
        return { ...l, w: canvas.measureText(l.name).width + 14, h: 20 };
      });
      return { ui: [box('.bg-find input'), box('.bg-legend'), box('.bg-lenses')].filter(Boolean), lobes };
    })()`);
    assert.equal(ui.ui.length, 3, `at ${w}x${hgt} the find, legend and views all draw`);
    for (const lobe of ui.lobes) {
      for (const box of ui.ui) {
        assert.ok(!overlaps(lobe, box), `at ${w}x${hgt} ${lobe.name} clears ${box.sel} (lobe ${Math.round(lobe.x)},${Math.round(lobe.y)} ${Math.round(lobe.w)}x${Math.round(lobe.h)} vs ${box.sel} ${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.w)}x${Math.round(box.h)})`);
      }
    }
    for (const lab of snap.labels) {
      for (const box of ui.ui) {
        assert.ok(!overlaps(lab, box), `at ${w}x${hgt} note ${lab.id} clears ${box.sel}`);
      }
    }
  }
});
