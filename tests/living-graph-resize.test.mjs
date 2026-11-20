// node --test tests/living-graph-resize.test.mjs - the graph re-fits when the window grows (t37, 8 Nov 2026):
// opened small then made big untouched, the vault fills the bigger canvas again; once the person has taken
// the camera (pan, zoom, drag, walk) a resize keeps their view; the backing follows resizes and display-scale
// changes so points stay sharp; same for the note's own small graph when its panel or the window changes size.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { startHarness } from './vault-controls-harness.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');

test('wiring: a resize re-fits while untouched, keeps once taken, and sharpens on display-scale change', () => {
  const engine = read('src/renderer/src/lib/living-engine.ts');
  // The refit on resize while the framing is still automatic (smooth: through reframe, not instant).
  assert.ok(engine.includes('size:refit'), 'a resize refits while untouched (size:refit trace)');
  assert.ok(engine.includes('|| this.camTouched ||'), 'once taken, a resize keeps the view');
  assert.ok(engine.includes('this.reframe()'), 'the refit glides (reframe, never an instant jump)');
  // A new window shape re-lays the clouds when its band changes (narrow/wide/ultra: one fixed shape cannot
  // fill both a narrow window and an ultrawide past 70%), never on a pixel of chrome wobble.
  assert.ok(engine.includes('livingAspectBand('), 'the resize check reads the aspect band');
  assert.ok(engine.includes('size:rehome'), 'a band change re-homes the clouds (size:rehome trace)');
  // The backing follows a display-scale change, not just a resize.
  assert.ok(engine.includes('(resolution:'), 'a display-scale change sharpens the canvas (resolution query)');
  // Dragging a point counts as taking the camera, like a pan, a zoom or a keyboard walk.
  const takes = (engine.match(/this\.camTouched = true;/g) ?? []).length;
  assert.ok(takes >= 4, `a pan, zoom, drag and walk each take the camera (${takes} takes)`);
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(h, js, ms = 60000) {
  const t0 = Date.now();
  for (;;) {
    try {
      if (await h.browser.ev(js)) return true;
    } catch {}
    if (Date.now() - t0 > ms) return false;
    await sleep(250);
  }
}
async function clickWords(h, words, scope = '') {
  const SEL = 'button, a[href], select, input, textarea, [role="button"], [role="tab"], [role="menuitem"], summary';
  return await h.browser.ev(`(async () => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
    const root = ${scope ? `document.querySelector(${JSON.stringify(scope)})` : 'document'};
    if (!root) return 'NOROOT';
    const els = [...root.querySelectorAll(${JSON.stringify(SEL)})].filter(vis);
    const el = els.find((e) => ((e.innerText || e.getAttribute('aria-label') || e.title || '').replace(/\\s+/g, ' ').includes(${JSON.stringify(words)})));
    if (!el) return 'NOTFOUND';
    el.scrollIntoView({ block: 'nearest' });
    el.click();
    await new Promise((r) => setTimeout(r, 400));
    return 'CLICKED';
  })()`);
}
async function openRoom(h, name) {
  if ((await clickWords(h, name, '.sidebar.left, aside')) === 'CLICKED') return;
  assert.equal(await clickWords(h, 'More', '.sidebar.left, aside'), 'CLICKED', `More opens for ${name}`);
  await sleep(500);
  assert.equal(await clickWords(h, name, '.menu, [role="menu"]'), 'CLICKED', `${name} opens from More`);
}
const snapOf = (h) => h.browser.ev(`window.__nvLivingGraph.snapshot()`);
function fillOf(s) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of s.nodes) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x);
    maxY = Math.max(maxY, n.y);
  }
  const usable = s.view.w - 220;
  return { fw: (maxX - minX) / usable, fh: (maxY - minY) / s.view.h, bw: maxX - minX, bh: maxY - minY };
}
// A made-up vault of realistic size (areas with counts, people and meetings joining them): big enough that the fit
// is about the shape, never the zoom cap, so a missed refit reads as empty canvas.
function writeBigVault(dir) {
  const areas = [['Work', 22], ['Business', 15], ['Home', 12], ['Me', 12], ['People', 10], ['Health', 8], ['Publications', 8], ['Meetings', 8]];
  const titles = [];
  for (const [area, count] of areas) for (let i = 1; i <= count; i++) titles.push({ area, title: `${area} note ${i}`, file: `${area}/${area} note ${i}.md` });
  const byArea = new Map();
  for (const t of titles) {
    const l = byArea.get(t.area) ?? [];
    l.push(t);
    byArea.set(t.area, l);
  }
  const people = byArea.get('People');
  const meetings = byArea.get('Meetings');
  let seed = 20261108;
  const rnd = (n) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % n;
  };
  for (const t of titles) {
    const links = [];
    const mates = byArea.get(t.area).filter((m) => m !== t);
    if (mates.length) links.push(mates[rnd(mates.length)].title);
    if (t.area !== 'People') links.push(people[rnd(people.length)].title);
    if (t.area !== 'Meetings' && rnd(2) === 0) links.push(meetings[rnd(meetings.length)].title);
    const body = `# ${t.title}\n\n${links.map((l) => `See [[${l}]].`).join(' ')}\n`;
    const p = path.join(dir, ...t.file.split('/'));
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, body);
  }
}

test('live: opened small then made big untouched, the vault fills the big canvas; a pan keeps the view', { timeout: 600000 }, async () => {
  const h = await startHarness();
  try {
    await h.services.invoke('settings:update', [{ prefs: { showTabs: true } }]);
    writeBigVault(h.vaultDir);
    await h.services.rescanAll();
    await h.browser.send('Emulation.setDeviceMetricsOverride', { width: 1263, height: 733, deviceScaleFactor: 1, mobile: false });
    await h.browser.send('Page.navigate', { url: `${h.origin}/harness.html?graph=living` });
    for (let i = 0; i < 90; i++) {
      await sleep(500);
      try {
        if (await h.browser.ev(`!!document.querySelector('.app')`)) break;
      } catch {}
    }
    await sleep(2000);
    await openRoom(h, 'Graph');
    assert.ok(await waitFor(h, `window.__nvLivingGraph && window.__nvLivingGraph.snapshot().count > 40`), 'the big vault draws');
    assert.ok(await waitFor(h, `window.__nvLivingGraph.snapshot().framed`, 90000), 'it settles and frames small');
    await sleep(800);
    const small = await snapOf(h);
    const fs = fillOf(small);
    assert.ok(small.count > 40, `${small.count} points draw (needs a vault, not a handful)`);
    assert.ok(fs.fw > 0.7 && fs.fh > 0.7, `opened at size it fills its canvas (${Math.round(fs.fw * 100)}% by ${Math.round(fs.fh * 100)}%, needs 70)`);
    // The untouched resize: maximised to the screen, the vault fills the big canvas again.
    await h.browser.send('Emulation.setDeviceMetricsOverride', { width: 3456, height: 1408, deviceScaleFactor: 1, mobile: false });
    assert.ok(await waitFor(h, `window.__nvLivingGraph.snapshot().framed`, 90000), 'it re-lays and frames big');
    await sleep(800);
    const big = await snapOf(h);
    const fb = fillOf(big);
    assert.ok(fb.fw > 0.7 && fb.fh > 0.7, `resized untouched it fills the big canvas (${Math.round(fb.fw * 100)}% by ${Math.round(fb.fh * 100)}% on ${big.view.w}x${big.view.h}, needs 70)`);
    assert.ok(Math.abs(big.cam.k - small.cam.k) > 0.05, `the camera re-fit (k ${small.cam.k.toFixed(2)} to ${big.cam.k.toFixed(2)})`);
    // The backing follows the resize, so points stay sharp.
    const sharp = await h.browser.ev(`(() => { const c = document.querySelector('.lg-canvas'); const r = c.getBoundingClientRect(); return { w: c.width, h: c.height, cssW: Math.round(r.width), cssH: Math.round(r.height), dpr: window.devicePixelRatio }; })()`);
    assert.equal(sharp.w, Math.round(sharp.cssW * Math.min(2, sharp.dpr)), `backing follows the resize (${sharp.w}x${sharp.h} for ${sharp.cssW}x${sharp.cssH} at dpr ${sharp.dpr})`);
    assert.equal(sharp.h, Math.round(sharp.cssH * Math.min(2, sharp.dpr)), `backing follows the resize (${sharp.w}x${sharp.h} for ${sharp.cssW}x${sharp.cssH} at dpr ${sharp.dpr})`);
    // A display-scale change alone sharpens without moving the camera.
    await h.browser.send('Emulation.setDeviceMetricsOverride', { width: 3456, height: 1408, deviceScaleFactor: 2, mobile: false });
    await sleep(1200);
    const hidpi = await h.browser.ev(`(() => { const c = document.querySelector('.lg-canvas'); const r = c.getBoundingClientRect(); return { w: c.width, h: c.height, cssW: Math.round(r.width), cssH: Math.round(r.height), dpr: window.devicePixelRatio }; })()`);
    assert.equal(hidpi.dpr, 2, 'the scale changed');
    assert.equal(hidpi.w, hidpi.cssW * 2, `the backing doubles with the scale (${hidpi.w} for ${hidpi.cssW} wide)`);
    const afterScale = await snapOf(h);
    assert.ok(Math.abs(afterScale.cam.k - big.cam.k) < 1e-9 && Math.abs(afterScale.cam.cx - big.cam.cx) < 1e-9, 'a scale change moves nothing');
    await h.browser.send('Emulation.setDeviceMetricsOverride', { width: 3456, height: 1408, deviceScaleFactor: 1, mobile: false });
    await sleep(800);
    // Once taken, a resize keeps the view: pan, then shrink, the camera holds.
    const box = await h.browser.ev(`(() => { const r = document.querySelector('.lg-canvas').getBoundingClientRect(); return { x: r.x, y: r.y }; })()`);
    const view = (await snapOf(h)).view;
    const nodes = (await snapOf(h)).nodes;
    const cands = [{ x: view.w - 120, y: view.h - 120 }, { x: view.w - 120, y: 120 }, { x: 320, y: view.h - 120 }, { x: view.w / 2, y: view.h - 80 }];
    const empty = cands.find((c) => nodes.every((n) => Math.hypot(n.x - c.x, n.y - c.y) > 40)) ?? cands[0];
    const sx = Math.round(box.x + empty.x);
    const sy = Math.round(box.y + empty.y);
    await h.browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: sx, y: sy, button: 'left', clickCount: 1 });
    for (let i = 1; i <= 6; i++) {
      await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: sx + i * 18, y: sy + i * 10, button: 'left' });
      await sleep(60);
    }
    await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: sx + 108, y: sy + 60, button: 'left', clickCount: 1 });
    await sleep(800);
    const panned = await snapOf(h);
    assert.ok(Math.hypot(panned.cam.cx - afterScale.cam.cx, panned.cam.cy - afterScale.cam.cy) > 5, 'the drag panned (the camera is taken)');
    await h.browser.send('Emulation.setDeviceMetricsOverride', { width: 2000, height: 1000, deviceScaleFactor: 1, mobile: false });
    await sleep(1200);
    const kept = await snapOf(h);
    assert.ok(Math.abs(kept.cam.cx - panned.cam.cx) < 1e-9 && Math.abs(kept.cam.cy - panned.cam.cy) < 1e-9 && Math.abs(kept.cam.k - panned.cam.k) < 1e-9, `a resize after a pan keeps the view (stayed ${kept.cam.cx.toFixed(1)},${kept.cam.cy.toFixed(1)}@${kept.cam.k.toFixed(2)})`);
  } finally {
    await h.close().catch(() => {});
  }
});

test('live: the note’s own graph follows its panel and stays sharp', { timeout: 600000 }, async () => {
  const h = await startHarness();
  try {
    await h.services.invoke('settings:update', [{ prefs: { showTabs: true } }]);
    await h.browser.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
    await h.browser.send('Page.navigate', { url: `${h.origin}/harness.html?graph=living` });
    for (let i = 0; i < 90; i++) {
      await sleep(500);
      try {
        if (await h.browser.ev(`!!document.querySelector('.app')`)) break;
      } catch {}
    }
    await sleep(2000);
    await openRoom(h, 'Graph');
    assert.ok(await waitFor(h, `window.__nvLivingGraph && window.__nvLivingGraph.snapshot().count > 0`), 'the vault draws');
    assert.ok(await waitFor(h, `window.__nvLivingGraph.snapshot().settled`, 60000), 'it settles');
    // Into a note (one click only selects now; double-click opens): its Connections graph draws in the right side.
    const s = await snapOf(h);
    const t = s.nodes.find((x) => x.id === 'Projects/Harbourline Cart Fix/Harbourline Cart Fix.md') ?? s.nodes[0];
    const box = await h.browser.ev(`(() => { const r = document.querySelector('.lg-canvas').getBoundingClientRect(); return { x: r.x, y: r.y }; })()`);
    await h.browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(box.x + t.x), y: Math.round(box.y + t.y), button: 'left', clickCount: 1 });
    await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(box.x + t.x), y: Math.round(box.y + t.y), button: 'left', clickCount: 1 });
    await sleep(120);
    await h.browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(box.x + t.x), y: Math.round(box.y + t.y), button: 'left', clickCount: 2 });
    await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(box.x + t.x), y: Math.round(box.y + t.y), button: 'left', clickCount: 2 });
    await sleep(1500);
    if ((await h.browser.ev(`!!document.querySelector('.sidebar.right')`)) === false) {
      assert.equal(await clickWords(h, 'Show the right side'), 'CLICKED', 'the right side opens');
      await sleep(1200);
    }
    // The note's panes are on the right side's Note tab (20 Nov 2026: Chat | Note).
    await h.browser.ev(`document.querySelector('#side-tab-note:not([aria-selected="true"])')?.click()`);
    assert.ok(await waitFor(h, `!!document.querySelector('.local-graph .lg-canvas')`), 'the note’s graph draws');
    assert.ok(await waitFor(h, `window.__nvLivingGraph.snapshot().centre !== null`, 30000), 'it centres on the note');
    await sleep(1200);
    const before = await snapOf(h);
    assert.ok(before.view.w < 600 && before.view.h < 400, `the small graph is small (${before.view.w}x${before.view.h})`);
    const sharp = await h.browser.ev(`(() => { const c = document.querySelector('.local-graph .lg-canvas'); const r = c.getBoundingClientRect(); return { w: c.width, h: c.height, cssW: Math.round(r.width), cssH: Math.round(r.height) }; })()`);
    assert.equal(sharp.w, sharp.cssW, `its backing matches its panel (${sharp.w} for ${sharp.cssW} wide)`);
    // Widen the panel: the backing follows, and the untouched view stays centred.
    const grip = await h.browser.ev(`(() => { const r = document.querySelector('.side-resizer.right').getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`);
    await h.browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: grip.x, y: grip.y, button: 'left', clickCount: 1 });
    for (let i = 1; i <= 8; i++) {
      await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: grip.x - i * 15, y: grip.y, button: 'left' });
      await sleep(50);
    }
    await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: grip.x - 120, y: grip.y, button: 'left', clickCount: 1 });
    await sleep(1500);
    const after = await snapOf(h);
    assert.ok(after.view.w > before.view.w + 60, `the panel widened (${before.view.w} to ${after.view.w})`);
    const sharp2 = await h.browser.ev(`(() => { const c = document.querySelector('.local-graph .lg-canvas'); const r = c.getBoundingClientRect(); return { w: c.width, h: c.height, cssW: Math.round(r.width), cssH: Math.round(r.height) }; })()`);
    assert.equal(sharp2.w, sharp2.cssW, `its backing follows the panel (${sharp2.w} for ${sharp2.cssW} wide)`);
    const centre = after.nodes.find((x) => x.id === after.centre);
    assert.ok(centre, 'the centre still draws');
    assert.ok(Math.abs(centre.x - after.view.w / 2) < after.view.w * 0.2 && Math.abs(centre.y - after.view.h / 2) < after.view.h * 0.3, `untouched it stays centred (at ${Math.round(centre.x)},${Math.round(centre.y)} in ${after.view.w}x${after.view.h})`);
    // A display-scale change sharpens it too.
    await h.browser.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 2, mobile: false });
    await sleep(1200);
    const hidpi = await h.browser.ev(`(() => { const c = document.querySelector('.local-graph .lg-canvas'); const r = c.getBoundingClientRect(); return { w: c.width, cssW: Math.round(r.width), dpr: window.devicePixelRatio }; })()`);
    assert.equal(hidpi.dpr, 2, 'the scale changed');
    assert.equal(hidpi.w, hidpi.cssW * 2, `its backing doubles with the scale (${hidpi.w} for ${hidpi.cssW} wide)`);
  } finally {
    await h.close().catch(() => {});
  }
});
