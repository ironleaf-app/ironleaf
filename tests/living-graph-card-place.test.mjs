// node --test tests/living-graph-card-place.test.mjs - the graph's card never covers what you
// clicked (9 Nov 2026, the laptop click: the card sat on the point's own name, "Backupbo").
// The card sits beside the point: clear of the point and its name, on the side with the most room,
// whole inside the canvas, clear of the legend; it follows smoothly without jittering with the drift,
// and pins readable at the edge when the point leaves.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startHarness } from './vault-controls-harness.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-card-place-'));
let L;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  await build({ input: path.join(root, 'src/shared/living-graph.ts'), platform: 'node', output: { file: path.join(work, 'l.mjs'), format: 'esm' }, logLevel: 'silent' });
  L = await import(pathToFileURL(path.join(work, 'l.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const circleHitsRect = (px, py, r, left, top, w, h) => {
  const cx = Math.min(left + w, Math.max(left, px));
  const cy = Math.min(top + h, Math.max(top, py));
  return Math.hypot(px - cx, py - cy) < r - 1;
};
const rectsHit = (a, b) => a.left < b.left + b.w - 1 && a.left + a.w > b.left + 1 && a.top < b.top + b.h - 1 && a.top + a.h > b.top + 1;

test('the card clears the name as well as the body, on the roomiest side', () => {
  // The laptop click: point mid-canvas, its name above it; right has the most room.
  const label = { x: 600, y: 322, w: 120, h: 20 };
  const c = L.placeLivingCard({ x: 600, y: 350, r: 6 }, 220, 120, 1219, 709, 220, label);
  const rect = { left: c.left, top: c.top, w: 220, h: 120 };
  assert.equal(circleHitsRect(600, 350, 6, c.left, c.top, 220, 120), false, `clear of the point (${c.left},${c.top})`);
  assert.equal(rectsHit(rect, { left: label.x - label.w / 2, top: label.y - label.h / 2, w: label.w, h: label.h }), false, `clear of the name (${c.left},${c.top})`);
  assert.ok(c.left >= 228 && c.left + 220 <= 1219 - 8 + 1 && c.top >= 8 - 1 && c.top + 120 <= 709 - 8 + 1, `whole and clear of the legend (${c.left},${c.top})`);
  assert.ok(c.left > 600, `stays on the right, where the room is (${c.left})`);
});

test('the card prefers the side with the most room, including above and below', () => {
  // Right fits, but left has more room: it goes left.
  assert.deepEqual(L.placeLivingCard({ x: 800, y: 350 }, 220, 120, 1219, 709, 220), { left: 564, top: 290 }, 'left wins when left is roomier');
  // Right still wins when right is roomier.
  assert.deepEqual(L.placeLivingCard({ x: 500, y: 350 }, 220, 120, 1219, 709, 220), { left: 516, top: 290 }, 'right wins when right is roomier');
  // Near the top it drops below; near the bottom it rises above.
  const top = L.placeLivingCard({ x: 600, y: 60 }, 220, 120, 1219, 709, 220);
  assert.ok(top.top > 60, `below the top point (${top.left},${top.top})`);
  const bottom = L.placeLivingCard({ x: 600, y: 650 }, 220, 120, 1219, 709, 220);
  assert.ok(bottom.top + 120 < 650, `above the bottom point (${bottom.left},${bottom.top})`);
});

test('the card pins inside at the edge when the point leaves', () => {
  for (const p of [{ x: -60, y: 350 }, { x: 1280, y: 350 }, { x: 600, y: -40 }, { x: 600, y: 760 }]) {
    const c = L.placeLivingCard({ x: p.x, y: p.y, r: 6 }, 220, 120, 1219, 709, 220);
    assert.ok(c.left >= 228 && c.left + 220 <= 1219 - 8 + 1, `inside sideways for (${p.x},${p.y}): ${c.left}`);
    assert.ok(c.top >= 8 - 1 && c.top + 120 <= 709 - 8 + 1, `inside upright for (${p.x},${p.y}): ${c.top}`);
  }
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

test('live: the card never covers its point or name, at 1920x1117 and 1219x709', { timeout: 600000 }, async () => {
  const h = await startHarness();
  try {
    await h.services.invoke('settings:update', [{ prefs: { showTabs: true } }]);
    const MAIN = '.nj-graph-body .lg-canvas';
    const snap = () => h.browser.ev(`window.__nvLivingGraph.snapshot()`);
    const tap = async (x, y, count = 1) => {
      await h.browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: count });
      await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: count });
    };
    const pageXY = async (cx, cy) => {
      const box = await h.browser.ev(`(() => { const r = document.querySelector(${JSON.stringify(MAIN)}).getBoundingClientRect(); return { x: r.x, y: r.y }; })()`);
      return { x: Math.round(box.x + cx), y: Math.round(box.y + cy) };
    };
    const rects = () => h.browser.ev(`(() => {
      const cr = document.querySelector(${JSON.stringify(MAIN)}).getBoundingClientRect();
      const card = document.querySelector('.nj-graph-body .lg-card');
      const lr = document.querySelector('.nj-graph-body .lg-legend').getBoundingClientRect();
      const r = card ? card.getBoundingClientRect() : null;
      return {
        card: r ? { left: r.x - cr.x, top: r.y - cr.y, w: r.width, h: r.height, text: card.innerText } : null,
        legend: { left: lr.x - cr.x, top: lr.y - cr.y, w: lr.width, h: lr.height },
      };
    })()`);
    const clearSelection = async () => {
      const s = await snap();
      const { card } = await rects();
      const cands = [{ x: s.view.w - 120, y: s.view.h - 120 }, { x: s.view.w - 120, y: 120 }, { x: 340, y: s.view.h - 120 }, { x: s.view.w / 2, y: s.view.h - 80 }, { x: 340, y: 120 }];
      const clearOfCard = (c) => !card || c.x < card.left - 20 || c.x > card.left + card.w + 20 || c.y < card.top - 20 || c.y > card.top + card.h + 20;
      const empty = cands.find((c) => clearOfCard(c) && s.nodes.every((n) => Math.hypot(n.x - c.x, n.y - c.y) > 40))
        ?? cands.find((c) => s.nodes.every((n) => Math.hypot(n.x - c.x, n.y - c.y) > 40)) ?? cands[0];
      const g = await pageXY(empty.x, empty.y);
      await tap(g.x, g.y);
      assert.ok(await waitFor(h, `window.__nvLivingGraph.snapshot().selected === null`, 5000), 'clears between clicks');
    };
    const checkCard = async (id, where) => {
      const s = await snap();
      assert.equal(s.selected, id, `${where}: still selected`);
      const p = s.nodes.find((n) => n.id === id);
      assert.ok(p, `${where}: point draws`);
      const { card, legend } = await rects();
      assert.ok(card && card.text.includes('Open'), `${where}: the card shows`);
      assert.ok(card.left >= -1 && card.top >= -1 && card.left + card.w <= s.view.w + 1 && card.top + card.h <= s.view.h + 1,
        `${where}: whole inside ${s.view.w}x${s.view.h} (at ${Math.round(card.left)},${Math.round(card.top)} ${Math.round(card.w)}x${Math.round(card.h)})`);
      const cx = Math.min(card.left + card.w, Math.max(card.left, p.x));
      const cy = Math.min(card.top + card.h, Math.max(card.top, p.y));
      assert.ok(Math.hypot(p.x - cx, p.y - cy) >= p.r - 1, `${where}: clear of the point (point ${Math.round(p.x)},${Math.round(p.y)} r${Math.round(p.r)}, card ${Math.round(card.left)},${Math.round(card.top)})`);
      const lab = s.labels.find((l) => l.id === id);
      if (lab) {
        const lr = { left: lab.x - lab.w / 2, top: lab.y - lab.h / 2, w: lab.w, h: lab.h };
        const hit = card.left < lr.left + lr.w - 1 && card.left + card.w > lr.left + 1 && card.top < lr.top + lr.h - 1 && card.top + card.h > lr.top + 1;
        assert.equal(hit, false, `${where}: clear of the name (label ${Math.round(lr.left)},${Math.round(lr.top)} ${Math.round(lr.w)}x${Math.round(lr.h)}, card ${Math.round(card.left)},${Math.round(card.top)})`);
      }
      const legHit = card.left < legend.left + legend.w - 1 && card.left + card.w > legend.left + 1 && card.top < legend.top + legend.h - 1 && card.top + card.h > legend.top + 1;
      assert.equal(legHit, false, `${where}: clear of the legend`);
    };
    for (const [W, H] of [[1920, 1117], [1219, 709]]) {
      // Fresh page per size: clicks take the camera, so a resize would keep the old fit and strand
      // points off the smaller canvas instead of filling it.
      await h.browser.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
      await h.browser.send('Page.navigate', { url: `${h.origin}/harness.html?graph=living` });
      for (let i = 0; i < 90; i++) {
        await sleep(500);
        try {
          if (await h.browser.ev(`!!document.querySelector('.app')`)) break;
        } catch {}
      }
      await sleep(2000);
      await openRoom(h, 'Graph');
      assert.ok(await waitFor(h, `window.__nvLivingGraph && window.__nvLivingGraph.snapshot().count > 0`), `${W}x${H}: points draw`);
      assert.ok(await waitFor(h, `window.__nvLivingGraph.snapshot().framed`, 90000), `${W}x${H}: settles`);
      await sleep(600);
      const s = await snap();
      // Clickable points only: clear of the legend and inside the canvas.
      const click = s.nodes.filter((n) => n.x > 240 && n.y > 10 && n.x < s.view.w - 10 && n.y < s.view.h - 10);
      assert.ok(click.length >= 4, `${W}x${H}: enough clickable points (${click.length} of ${s.nodes.length})`);
      const byX = [...click].sort((a, b) => a.x - b.x);
      const byY = [...click].sort((a, b) => a.y - b.y);
      const mid = { x: s.view.w / 2, y: s.view.h / 2 };
      const centre = [...click].sort((a, b) => Math.hypot(a.x - mid.x, a.y - mid.y) - Math.hypot(b.x - mid.x, b.y - mid.y))[0];
      const picks = [byX[0], byX[byX.length - 1], byY[0], byY[byY.length - 1], centre].filter((p, i, a) => p && a.findIndex((q) => q.id === p.id) === i);
      assert.ok(picks.length >= 4, `${W}x${H}: points near each edge and the centre (${picks.map((p) => `${p.title}@${Math.round(p.x)},${Math.round(p.y)}`).join(', ')})`);
      for (const want of picks) {
        // Fresh coords per try: the drift moves the point under a stale click.
        let picked = false;
        for (let tries = 0; tries < 3 && !picked; tries++) {
          const cur = (await snap()).nodes.find((n) => n.id === want.id);
          const g = await pageXY(cur.x, cur.y);
          await tap(g.x, g.y);
          picked = await waitFor(h, `window.__nvLivingGraph.snapshot().selected === ${JSON.stringify(want.id)}`, 2500);
          if (!picked) await clearSelection();
        }
        const got = (await snap()).selected;
        assert.ok(picked, `${W}x${H}: ${want.title} selects (got ${got})`);
        assert.ok(await waitFor(h, `((document.querySelector('.nj-graph-body .lg-card') || {}).innerText || '').includes('Open')`, 5000), `${W}x${H}: its card shows`);
        await sleep(700);
        await checkCard(want.id, `${W}x${H} ${want.title}`);
        await clearSelection();
      }
      // Through the drift the card holds still: 12 samples over 3 s, at most an occasional
        // ease after a real move, never the per-sample shake of following the breath.
      if (W === 1920) {
        const cur = (await snap()).nodes.find((n) => n.id === centre.id);
        const g = await pageXY(cur.x, cur.y);
        await tap(g.x, g.y);
        assert.ok(await waitFor(h, `((document.querySelector('.nj-graph-body .lg-card') || {}).innerText || '').includes('Open')`, 5000), 'drift check: the card shows');
        await sleep(1500);
        const first = (await rects()).card;
        let prev = first;
        let moves = 0;
        let worst = 0;
        for (let i = 0; i < 12; i++) {
          await sleep(250);
          const c = (await rects()).card;
          if (Math.hypot(c.left - prev.left, c.top - prev.top) > 0.5) moves++;
          prev = c;
          worst = Math.max(worst, Math.hypot(c.left - first.left, c.top - first.top));
        }
        assert.ok(moves <= 2, `the card never jitters with the drift (${moves} moves in 3 s)`);
        assert.ok(worst < 12, `it holds its seat through the breath (wandered ${worst.toFixed(1)}px in 3 s)`);
        // Pan the point off the canvas: the card stays readable at the edge.
        const s0 = await snap();
        const cands = [{ x: s0.view.w - 140, y: s0.view.h - 140 }, { x: s0.view.w - 140, y: 140 }, { x: 360, y: s0.view.h - 140 }];
        const card0 = (await rects()).card;
        const empty = cands.find((c) => s0.nodes.every((n) => Math.hypot(n.x - c.x, n.y - c.y) > 40) && (c.x < card0.left - 20 || c.x > card0.left + card0.w + 20 || c.y < card0.top - 20 || c.y > card0.top + card0.h + 20)) ?? cands[0];
        for (let round = 0; round < 3; round++) {
          const g0 = await pageXY(empty.x, empty.y);
          await h.browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: g0.x, y: g0.y, button: 'left', clickCount: 1 });
          for (let i = 1; i <= 10; i++) {
            await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: g0.x - i * 60, y: g0.y - i * 40, button: 'left', buttons: 1 });
            await sleep(30);
          }
          await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: g0.x - 600, y: g0.y - 400, button: 'left', clickCount: 1 });
          await sleep(1000);
          const sp = (await snap()).nodes.find((n) => n.id === centre.id);
          const sv = (await snap()).view;
          if (sp.x < 0 || sp.y < 0 || sp.x > sv.w || sp.y > sv.h) break;
        }
        const s1 = await snap();
        const p1 = s1.nodes.find((n) => n.id === centre.id);
        assert.ok(p1.x < 0 || p1.y < 0 || p1.x > s1.view.w || p1.y > s1.view.h, `the point left the canvas (at ${Math.round(p1.x)},${Math.round(p1.y)} in ${s1.view.w}x${s1.view.h})`);
        const { card } = await rects();
        assert.ok(card && card.text.includes('Open'), 'the card stays readable at the edge');
        assert.ok(card.left >= -1 && card.top >= -1 && card.left + card.w <= s1.view.w + 1 && card.top + card.h <= s1.view.h + 1, `pinned inside at the edge (${Math.round(card.left)},${Math.round(card.top)})`);
        await clearSelection();
      }
    }
  } finally {
    await h.close().catch(() => {});
  }
});
