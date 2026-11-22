// node --test tests/graph-smooth.test.mjs - the graph stays smooth on a normal laptop (9 Nov 2026, after
// 10.1.8). A 3456x1408 window on integrated graphics, a graph of about 170 notes and 275 links.
// Speed only: how the frame is made, never how it looks. Measured in headless Chromium at 3456x1408,
// device scale 2, with 4x CPU throttle as the stand-in for a laptop, on a made-up vault shaped like
// theirs (157 notes, 277 links). The software raster in headless dominates wall time (a full 15M-pixel
// backing costs ~400 ms a frame, the JS about 3 ms), so the rest budget asserts wall intervals (near zero
// work at rest: the loop must not repaint every frame) while the pan budget asserts the engine's own draw
// cost (JS work stays under budget while moving).
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { startHarness } from './vault-controls-harness.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A made-up made-up vault of realistic size: Work 56 (two projects), Me 47, Business 14, Publications 12,
// Home 10, Health 5, Top 1, plus People and Meetings. Draws 157 points and 277 threads.
function writeVault170(dir) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const w = (rel, text, daysAgo = 20) => {
    const p = path.join(dir, ...rel.split('/'));
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, text);
    const t = new Date(Date.now() - daysAgo * 86400000);
    try {
      utimesSync(p, t, t);
    } catch {}
  };
  let seed = 20261109;
  const rnd = (n) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % n;
  };
  const people = ['Alex Chen', 'Priya Nair', 'Sam Ortega', 'June Park', 'Tom Bradley', 'Lucy Hammond'];
  for (const p of people) w(`People/${p}.md`, `---\ntype: person\nrole: Friend\n---\n# ${p}\n\nWorks with [[Harbourline]].\n`, rnd(30));
  const meetings = ['Standup', 'Planning', 'Review', 'Retro', 'Kickoff', 'Sync'];
  for (const m of meetings) w(`Meetings/${m}.md`, `---\ntype: meeting\ndate: 2026-11-08\nattendees: [Alex Chen]\n---\n# ${m}\n\nMet with [[Alex Chen]] about [[Harbourline]].\n`, rnd(10));
  w('Work/Harbourline/Harbourline.md', `---\ntype: project\nstatus: active\nowner: Alex Chen\ndue: 2026-11-20\n---\n# Harbourline\n\nSee [[Receipts spec]].\n`, 2);
  for (let i = 1; i <= 8; i++) w(`Work/Harbourline/Harbour note ${i}.md`, `# Harbour note ${i}\n\nPart of [[Harbourline]]. Asked [[${people[rnd(6)]}]].\n`, rnd(30));
  w('Work/Roster/Roster.md', `---\ntype: project\nstatus: active\nowner: Alex Chen\n---\n# Roster\n\nRoster with [[Alex Chen]].\n`, 3);
  const areas = [['Work', 46], ['Me', 47], ['Business', 14], ['Publications', 12], ['Home', 10], ['Health', 5]];
  const all = ['Harbourline', 'Roster', 'Standup', 'Planning', ...people];
  for (const [area, count] of areas) {
    for (let i = 1; i <= count; i++) {
      const links = [all[rnd(all.length)]];
      if (rnd(2) === 0) links.push(all[rnd(all.length)]);
      w(`${area}/${area} note ${i}.md`, `# ${area} note ${i}\n\n${links.map((l) => `See [[${l}]].`).join(' ')}\n`, rnd(30));
    }
  }
  w('Top.md', `# Top\n\nSee [[Harbourline]] and [[Alex Chen]].\n`, 10);
}

test('wiring: the frame reuses what it measured and sleeps at rest', () => {
  const engine = read('src/renderer/src/lib/living-engine.ts');
  assert.ok(engine.includes('legendCache'), 'the legend box is measured once and kept, not every frame');
  assert.ok(engine.includes('textW'), 'title widths are cached, not re-measured every frame');
  assert.ok(engine.includes('REST_DRAW_MS'), 'drift redraws run at a low rate at rest');
  // 9 Nov 2026. Measured on the laptop: resting at a low rate let the graphics side idle and the next click waited
  // 200-470 ms; with the mouse over the graph it keeps drawing every frame, so it is awake when the click lands.
  assert.ok(/restQuiet\(t0, settled\) && !this\.pointerIn/.test(engine), 'with the mouse over the graph it never rests');
  assert.ok(/private move\(e: PointerEvent\): void \{\s*this\.pointerIn = true/.test(engine) && /private leave\(\): void \{\s*this\.pointerIn = false/.test(engine), 'the mouse arriving wakes it, leaving lets it rest');
  // A mouse coming back from elsewhere arrives faster than the graphics side wakes (laptop: 200-350 ms stalls), so
  // a 4px pilot is redrawn every resting frame while the window is in front, and goes with the graph.
  assert.ok(engine.includes("pilot.className = 'lg-pilot'") && /else if \(this\.pilot && document\.hasFocus\(\)\)/.test(engine) && /sig\.addEventListener\('abort', \(\) => pilot\.remove\(\)\)/.test(engine), 'the pilot keeps the graphics side awake at rest, and leaves with the graph');
  assert.ok(engine.includes('bgLayer'), 'the background and vignette pre-render once per size');
  assert.ok(engine.includes('document.hidden'), 'the loop stops when the window or tab hides');
});

test('live: near zero work at rest, cheap frames while panning, at 3456x1408 under throttle', { timeout: 600000 }, async () => {
  const h = await startHarness();
  try {
    writeVault170(h.vaultDir);
    await h.services.rescanAll();
    await h.services.invoke('settings:update', [{ prefs: { showTabs: true } }]);
    await h.browser.send('Page.navigate', { url: `${h.origin}/harness.html?graph=living` });
    for (let i = 0; i < 90; i++) {
      await sleep(500);
      try {
        if (await h.browser.ev(`!!document.querySelector('.app')`)) break;
      } catch {}
    }
    await sleep(2000);
    // The graph opens from the palette when the side bar keeps it under More.
    const opened = await h.browser.ev(`(async () => {
      const SEL = 'button, a[href], select, input, textarea, [role="button"], [role="tab"], [role="menuitem"], summary';
      const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
      const els = [...document.querySelector('.sidebar.left, aside').querySelectorAll(SEL)].filter(vis);
      const el = els.find((e) => (e.innerText || '').replace(/\\s+/g, ' ').includes('Graph'));
      if (!el) return 'NOTFOUND';
      el.click();
      await new Promise((r) => setTimeout(r, 400));
      return 'CLICKED';
    })()`);
    if (opened !== 'CLICKED') {
      await h.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75 });
      await h.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75 });
      await sleep(700);
      await h.browser.send('Input.insertText', { text: 'Graph' });
      await sleep(900);
      await h.browser.ev(`(() => { const rows = [...document.querySelectorAll('.picker-row')]; const t = (x, s) => x.querySelector(s)?.innerText.trim() ?? ''; (rows.find((x) => t(x, '.picker-label') === 'Open the graph') ?? rows.find((x) => t(x, '.picker-label') === 'Graph')).click(); return 1; })()`);
      await sleep(600);
    }
    await h.browser.send('Emulation.setDeviceMetricsOverride', { width: 3456, height: 1408, deviceScaleFactor: 2, mobile: false });
    await sleep(1200);
    const t0 = Date.now();
    for (;;) {
      try {
        if (await h.browser.ev(`window.__nvLivingGraph && window.__nvLivingGraph.snapshot().framed`)) break;
      } catch {}
      assert.ok(Date.now() - t0 < 180000, 'the vault settles');
      await sleep(500);
    }
    const shaped = await h.browser.ev(`window.__nvLivingGraph.snapshot()`);
    assert.ok(shaped.count > 100, `realistic size: ${shaped.count} points`);
    assert.ok(shaped.links > 200, `realistic size: ${shaped.links} threads`);
    await h.browser.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await h.browser.ev(`(() => { window.__ft = []; let last = performance.now(); const hook = () => { const now = performance.now(); window.__ft.push(now - last); last = now; requestAnimationFrame(hook); }; requestAnimationFrame(hook); return 1; })()`);
    await sleep(500);
    const q = (arr, p) => {
      const s = [...arr].sort((a, b) => a - b);
      return s[Math.min(s.length - 1, Math.floor(p * s.length))];
    };
    // At rest the loop barely paints: most frames cost nothing (before: every frame repainted,
    // p50 ~390 ms; after: drift redraws at a low rate, p50 ~17 ms).
    await h.browser.ev(`window.__ft = [];`);
    await sleep(6000);
    // Enough frames to judge, not a set time (23 Nov 2026): on a machine busy with the rest of the suite six
    // seconds at 4x throttle sometimes gave 29 frames; the samples keep coming until there are 31, up to 20 s.
    for (let waited = 6000; waited < 20000; waited += 1000) {
      if ((await h.browser.ev(`window.__ft.filter((x) => x < 5000).length`)) > 30) break;
      await sleep(1000);
    }
    const rest = (await h.browser.ev(`window.__ft.slice()`)).filter((x) => x < 5000);
    assert.ok(rest.length > 30, `frames flow at rest (${rest.length})`);
    assert.ok(q(rest, 0.5) < 50, `rest p50 under 50 ms (stood ${q(rest, 0.5).toFixed(1)} ms over ${rest.length} frames)`);
    // While panning every frame draws, but the JS stays cheap under throttle.
    const box = await h.browser.ev(`(() => { const r = document.querySelector('.nj-graph-body .lg-canvas').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
    const px = Math.round(box.x + box.w / 2);
    const py = Math.round(box.y + box.h / 2);
    await h.browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: px + 800, y: py + 300, button: 'left', clickCount: 1 });
    const pan0 = Date.now();
    let i = 0;
    while (Date.now() - pan0 < 4000) {
      i++;
      await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: px + 800 - i * 8, y: py + 300 - i * 3, button: 'left', buttons: 1 });
      await sleep(50);
    }
    await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: px + 800 - i * 8, y: py + 300 - i * 3, button: 'left', clickCount: 1 });
    const pan = await h.browser.ev(`window.__nvLivingGraph.snapshot()`);
    assert.ok(pan.draw, 'the engine reports its draw costs');
    // Draw cost under throttle, including the background blit (a 62 MB copy reads ~25 ms at 4x
    // throttle in software; on their graphics it is a sub-millisecond texture copy). Fails on a
    // real JS regression, not on raster noise.
    // The 45 ms holds where that blit reads ~25 ms; a machine busy with the rest of the suite reads it slower, so the
    // budget scales with a blit of the same size timed here, now, under the same throttle (23 Nov 2026): a draw that
    // got dearer than the machine did still fails.
    const blit = await h.browser.ev(`(() => {
      const g = document.querySelector('.nj-graph-body .lg-canvas');
      const w = g.width, hh = g.height;
      const src = document.createElement('canvas'); src.width = w; src.height = hh;
      const sc = src.getContext('2d'); sc.fillStyle = '#20302a'; sc.fillRect(0, 0, w, hh);
      const dst = document.createElement('canvas'); dst.width = w; dst.height = hh;
      const dc = dst.getContext('2d');
      const t = [];
      for (let i = 0; i < 9; i++) { const t0 = performance.now(); dc.drawImage(src, 0, 0); dc.getImageData(0, 0, 1, 1); t.push(performance.now() - t0); }
      t.sort((a, b) => a - b);
      return t[4];
    })()`);
    const budget = 45 * Math.max(1, blit / 25);
    console.log(`graph pan: draw p95 ${pan.draw.p95} ms over ${pan.draw.n} draws; same-size blit ${blit.toFixed(1)} ms; budget ${budget.toFixed(0)} ms`);
    assert.ok(pan.draw.p95 < budget, `pan draw p95 under ${budget.toFixed(0)} ms throttled (stood ${pan.draw.p95} ms over ${pan.draw.n} draws; a same-size blit reads ${blit.toFixed(1)} ms here)`);
  } finally {
    await h.close().catch(() => {});
  }
});
