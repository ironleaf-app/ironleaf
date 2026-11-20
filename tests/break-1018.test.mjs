// node --test tests/break-1018.test.mjs - break it before 10.1.8 (9 Nov 2026, on 10.1.7). The graph and More,
// broken the way a real person would on a made-up vault of realistic size (about 145 notes across Work, Me,
// Business, Publications, Home and Health, with people and projects): every check below failed before its
// fix. Real CDP input only, never synthetic page events; the mouse parks away from open menus while the keys
// drive (a cursor resting on a live menu re-asserts hover between reads).
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startHarness } from './vault-controls-harness.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const work = mkdtempSync(path.join(tmpdir(), 'nv-break-1018-'));
let MF;
let LG;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  await build({ input: path.join(root, 'src/shared/more-fit.ts'), platform: 'node', output: { file: path.join(work, 'mf.mjs'), format: 'esm' }, logLevel: 'silent' });
  MF = await import(pathToFileURL(path.join(work, 'mf.mjs')).href);
  await build({ input: path.join(root, 'src/shared/living-graph.ts'), platform: 'node', output: { file: path.join(work, 'lg.mjs'), format: 'esm' }, logLevel: 'silent' });
  LG = await import(pathToFileURL(path.join(work, 'lg.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

// --- helpers (real input only) ----------------------------------------------
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
const snap = (h) => h.browser.ev(`window.__nvLivingGraph.snapshot()`);
const errs = (h) => h.browser.ev(`(window.__breakErrs || [])`);
async function trap(h) {
  await h.browser.ev(`(function () {
    if (window.__breakErrs) return 'kept';
    window.__breakErrs = [];
    window.addEventListener('error', (e) => window.__breakErrs.push(String((e.error && e.error.stack) || e.message || e).slice(0, 300)));
    window.addEventListener('unhandledrejection', (e) => window.__breakErrs.push('reject: ' + String((e.reason && e.reason.stack) || e.reason).slice(0, 300)));
    return 'trap';
  })()`);
}
const tap = async (h, x, y, count = 1, mods = 0) => {
  await h.browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: count, modifiers: mods });
  await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: count, modifiers: mods });
};
const wheel = (h, x, y, dy, mods = 0) =>
  h.browser.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: Math.round(x), y: Math.round(y), deltaX: 0, deltaY: dy, modifiers: mods });
const key = async (h, keyName, code, vcode) => {
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: keyName, code, windowsVirtualKeyCode: vcode });
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code, windowsVirtualKeyCode: vcode });
};
const esc = (h) => key(h, 'Escape', 'Escape', 27);
const arrow = (h, dir) => key(h, `Arrow${dir}`, `Arrow${dir}`, { Down: 40, Up: 38, Right: 39, Left: 37 }[dir]);
// The mouse off the menu while the keys drive (else hover re-asserts between reads).
const park = (h) => h.browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1100, y: 650, button: 'none' });
async function find(h, js) {
  return await h.browser.ev(`(function () {
    const el = ${js};
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return null;
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, top: r.top, bottom: r.bottom };
  })()`);
}
async function clickWords(h, words, scope = '') {
  const p = await find(
    h,
    `(function () {
      const SEL = 'button, a[href], select, input, textarea, [role="button"], [role="tab"], [role="menuitem"], summary';
      const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
      const roots = ${scope ? `[...document.querySelectorAll(${JSON.stringify(scope)})]` : '[document]'};
      const els = roots.flatMap((root) => [...root.querySelectorAll(SEL)]);
      return els.filter(vis).find((e) => ((e.innerText || e.getAttribute('aria-label') || e.title || '').replace(/\\s+/g, ' ').includes(${JSON.stringify(words)}))) || null;
    })()`,
  );
  if (!p) return 'NOTFOUND';
  await tap(h, p.x, p.y);
  await sleep(400);
  return 'CLICKED';
}
const titles = (h) => h.browser.ev(`[...document.querySelectorAll('.tab-item .tab-title')].map((e) => e.textContent)`);

// A made-up a made-up vault of realistic size: Work 56 (two projects), Me 47, Business 14, Publications 12,
// Home 10, Health 5, Top 1, plus People and Meetings. Zoe Zed is known but has no note.
function writeVault(dir) {
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
  const people = ['Alex Chen', 'Priya Nair', 'Sam Ortega', 'June Park'];
  for (const p of people) w(`People/${p}.md`, `---\ntype: person\nrole: Friend of the vault\n---\n# ${p}\n\nWorks with [[Harbourline]].\n`, rnd(30));
  w('Meetings/Standup.md', `---\ntype: meeting\ndate: 2026-11-08\nattendees: [Alex Chen, Zoe Zed]\n---\n# Standup\n\nMet with [[Alex Chen]] and [[Zoe Zed]] about the [[Harbourline]].\n`, 1);
  w('Meetings/Planning.md', `---\ntype: meeting\ndate: 2026-11-02\nattendees: [Priya Nair]\n---\n# Planning\n\nPlanned [[Roster]] with [[Priya Nair]].\n`, 6);
  w('Work/Harbourline/Harbourline.md', `---\ntype: project\nstatus: active\nowner: Alex Chen\ndue: 2026-11-20\n---\n# Harbourline\n\nThe shop's cart drops orders. See [[Receipts spec]].\n\n- [ ] Retry twice — Alex Chen — due 2026-11-06\n`, 2);
  for (let i = 1; i <= 8; i++) w(`Work/Harbourline/Harbour note ${i}.md`, `# Harbour note ${i}\n\nPart of [[Harbourline]]. Asked [[${people[rnd(4)]}]]. See [[Standup]].\n`, rnd(30));
  w('Work/Roster/Roster.md', `---\ntype: project\nstatus: active\nowner: Zoe Zed\n---\n# Roster\n\nRoster the late shift with [[Zoe Zed]].\n`, 3);
  const areas = [['Work', 46], ['Me', 47], ['Business', 14], ['Publications', 12], ['Home', 10], ['Health', 5]];
  const all = ['Harbourline', 'Roster', 'Standup', 'Planning', ...people, 'Zoe Zed'];
  for (const [area, count] of areas) {
    for (let i = 1; i <= count; i++) {
      const links = [all[rnd(all.length)], all[rnd(all.length)]];
      if (rnd(2) === 0) links.push(`${area} note ${1 + rnd(count)}`);
      w(`${area}/${area} note ${i}.md`, `# ${area} note ${i}\n\n${links.map((l) => `See [[${l}]].`).join(' ')}\n`, rnd(30));
    }
  }
  w('Top.md', `# Top\n\nThe vault starts here. See [[Harbourline]] and [[Alex Chen]].\n`, 10);
  w('Templates/Old template.md', `# Old template\n\nSee [[Harbourline]].\n`, 40);
  w('Daily/2026-11-01.md', `# 1 Nov\n\nSaw [[Alex Chen]].\n`, 8);
  w('Private notes/Secret.md', `# Secret\n\nSee [[Harbourline]].\n`, 2);
}

// --- the centred zoom floor (F1) ---------------------------------------------
// A centred view framed below the zoom-out floor: the first notch in jumped to the floor
// (0.807 to 1.000, x1.24 not x1.1) and the frame could never come back.
test('a centred view zooms 1.1x from its frame and comes back to it', () => {
  // A hub at its cloud's edge: the centre fit (from the centre, like the frame) reads below the
  // whole-bounds fit, so the floor must mirror the frame, never the bounds.
  const nodes = [];
  for (let i = 0; i < 40; i++) nodes.push({ x: 200 + (i % 8) * 60, y: -150 + Math.floor(i / 8) * 60 });
  const k = LG.fitCentredK({ x: 0, y: 0 }, nodes, 1308, 826, false, 1.25);
  assert.ok(k < 1 && k >= 0.3, `the edge centre frames below 1x (k=${k.toFixed(3)})`);
  assert.equal(k, LG.fitCentredK({ x: 0, y: 0 }, nodes, 1308, 826, false, 1.25), 'the same frame twice');
});

test('wiring: the zoom-out floor is the centred frame when centred', () => {
  const engine = read('src/renderer/src/lib/living-engine.ts');
  assert.ok(engine.includes('fitCentredK('), 'frame and floor share one centre fit');
  assert.ok((engine.match(/fitCentredK\(/g) ?? []).length >= 2, 'both the frame and the floor read it');
  assert.ok(engine.includes('if (c) return fitCentredK(c, this.nodes'), 'a centred floor re-reads the frame, never the bounds');
});

// --- a taken camera survives a tab switch and back (F2) -----------------------
// Zoom, switch tab, back: the engine remounted and reframed (k 1.92 to 1.06), and the
// legend switches reset with it. The shell keeps the taken view per graph and puts it back.
test('wiring: the taken view is kept per graph and put back on remount', () => {
  const engine = read('src/renderer/src/lib/living-engine.ts');
  assert.ok(engine.includes('restoreCamera('), 'the engine takes back a kept camera');
  const view = read('src/renderer/src/components/GraphView.tsx');
  assert.ok(view.includes('restoreCamera('), 'the shell puts the kept view back');
});

// --- More folds its sections before it ever scrolls (M1) ----------------------
// Five pins and eight packs at 1219x709: all four groups folded and still 742px over 653px
// of room, so the menu scrolled and two rows ran 74px past the window.
test('More folds pins, then the bar, only once the groups cannot fit it', () => {
  const room = 709 - 8 - 46;
  // The break case: 5 pins, hidden rows (Pages 5, Make 4, Find 1), 8 packs (10 rows).
  const broke = { available: room, pinned: 5, folded: 0, eight: 8, groups: [{ id: 'pages', rows: 5 }, { id: 'make', rows: 4 }, { id: 'find', rows: 1 }, { id: 'packs', rows: 10 }] };
  const folded = MF.moreFoldToFit(broke);
  assert.ok(folded.includes('pinned'), `the pins fold as a last resort (folded: ${folded.join(', ')})`);
  assert.ok(MF.moreHeight({ ...broke, foldedIds: folded }) <= room, `the menu fits (${MF.moreHeight({ ...broke, foldedIds: folded })}px over ${room}px)`);
  // The bar folds after the pins when even that is not enough (a short window folds the bar into More).
  const worse = { ...broke, folded: 5 };
  const foldedWorse = MF.moreFoldToFit(worse);
  assert.ok(foldedWorse.includes('pinned') && foldedWorse.includes('bar'), `pins then the bar (folded: ${foldedWorse.join(', ')})`);
  assert.ok(MF.moreHeight({ ...worse, foldedIds: foldedWorse }) <= room, 'even that fits');
  // At a window shorter than the eight (320px high) the scroll cannot stop, so the rows stay
  // out instead of burying behind submenus (the folded bar rows wait at the top of More).
  const tiny = { available: 320 - 8 - 46, pinned: 0, folded: 4, eight: 8, groups: [{ id: 'pages', rows: 7 }, { id: 'make', rows: 6 }, { id: 'find', rows: 2 }, { id: 'packs', rows: 2 }] };
  const foldedTiny = MF.moreFoldToFit(tiny);
  assert.ok(!foldedTiny.includes('bar') && !foldedTiny.includes('pinned'), `tiny windows keep rows out (folded: ${foldedTiny.join(', ')})`);
  // And the pins stay visible while the groups alone can fit it (the old cases, unchanged).
  const full = { available: room, pinned: 2, folded: 0, eight: 8, groups: [{ id: 'pages', rows: 7 }, { id: 'make', rows: 6 }, { id: 'find', rows: 2 }, { id: 'packs', rows: 6 }] };
  const foldedFull = MF.moreFoldToFit(full);
  assert.ok(!foldedFull.includes('pinned') && !foldedFull.includes('bar'), `two pins stay out (folded: ${foldedFull.join(', ')})`);
  assert.ok(MF.moreHeight({ ...full, foldedIds: foldedFull }) <= room, 'a full vault still fits');
  const places = read('src/renderer/src/panels/Places.tsx');
  assert.ok(places.includes("'Pinned'") && places.includes("'From the side bar'"), 'a folded section keeps its rows behind one submenu row');
});

// --- the menu measures what it is, not its entrance (M2) ----------------------
// The settle runs from scale 0.97, and the menu measured its rendered box mid-settle,
// so every menu sat 3% too low and its last rows ran past the window (4px at 1219x709,
// 26px at 3456x1408).
test('wiring: menu placement measures the layout box, immune to the settle', () => {
  const menu = read('src/renderer/src/components/Menu.tsx');
  assert.ok(menu.includes('offsetHeight') && menu.includes('offsetWidth'), 'the layout box sizes the placement');
  assert.ok(!/getBoundingClientRect\(\)\.height/.test(menu) && !/\.height = r\.height/.test(menu), 'no rendered height feeds the placement');
});

// --- every submenu opens at its own row (M3) ----------------------------------
// openSub read the row list with an item index, so past a separator or heading every submenu
// anchored at the wrong row (Pages opened 254px too high, floating), and the last submenu
// ('Packs and kinds', 'Other kinds') opened nothing at all, by hover, click or Right.
test('wiring: a submenu anchors at the row asked for, by item, not by row order', () => {
  const menu = read('src/renderer/src/components/Menu.tsx');
  assert.ok(menu.includes('data-idx'), 'each row carries its item');
  assert.ok(!/querySelectorAll<HTMLElement>\('\.menu-row'\)\[index\]/.test(menu), 'no item index into the row list');
});

// --- live: real input on the real client --------------------------------------
let H;
before(async () => {
  H = await startHarness();
  writeVault(H.vaultDir);
  await H.services.rescanAll();
  await H.services.invoke('settings:update', [{ prefs: { showTabs: true } }]);
});
after(async () => {
  await H.close().catch(() => {});
});
async function boot(w, hh, prefs = {}, bookmarks = []) {
  await H.services.invoke('settings:update', [{ prefs }]);
  await H.services.invoke('state:save', ['bookmarks', bookmarks]);
  await H.browser.send('Emulation.setDeviceMetricsOverride', { width: w, height: hh, deviceScaleFactor: 1, mobile: false });
  await H.browser.send('Page.navigate', { url: `${H.origin}/harness.html?graph=living` });
  for (let i = 0; i < 90; i++) {
    await sleep(500);
    try {
      if (await H.browser.ev(`!!document.querySelector('.app')`)) break;
    } catch {}
  }
  await sleep(2000);
  await trap(H);
}
async function openMore() {
  // Shut first (every level), then open: tapping More while a menu still unmounts lands on its rows.
  for (let i = 0; i < 3; i++) {
    await esc(H);
    await sleep(350);
    if ((await H.browser.ev(`document.querySelectorAll('.menu').length`)) === 0) break;
  }
  const b = await find(H, `(function(){const btns=[...document.querySelectorAll('.sidebar.left button, aside button')].filter(e=>{const r=e.getBoundingClientRect();return r.width>2&&r.height>2});return btns.find(e=>(e.innerText||'').trim()==='More')||null})()`);
  assert.ok(b, 'the More row shows');
  await tap(H, b.x, b.y);
  await sleep(800);
  await park(H);
  await sleep(200);
}
async function menuRows(level = 0) {
  return await H.browser.ev(`(function(){
    const menus = [...document.querySelectorAll('.menu')].filter(e=>e.getBoundingClientRect().width>2);
    const m = menus[${level}];
    if (!m) return [];
    return [...m.querySelectorAll(':scope > .menu-row')].map((e) => {
      const r = e.getBoundingClientRect();
      return { label: e.querySelector('.menu-label')?.innerText ?? '', sub: !!e.querySelector('.menu-more'), disabled: !!e.disabled, x: r.x+r.width/2, y: r.y+r.height/2, top: Math.round(r.top), bottom: Math.round(r.bottom) };
    });
  })()`);
}

test('live: a centred view zooms 1.1x from its frame and comes back', { timeout: 600000 }, async () => {
  await boot(1600, 1000);
  assert.equal(await clickWords(H, 'More', '.sidebar.left, aside'), 'CLICKED', 'More opens');
  await sleep(600);
  assert.equal(await clickWords(H, 'Graph', '.menu, [role="menu"]'), 'CLICKED', 'Graph opens');
  await park(H);
  assert.ok(await waitFor(H, `window.__nvLivingGraph && window.__nvLivingGraph.snapshot().count > 100`), 'points draw');
  assert.ok(await waitFor(H, `window.__nvLivingGraph.snapshot().framed`, 90000), 'the vault settles');
  const e0 = (await errs(H)).length;
  const box = await H.browser.ev(`(() => { const r = document.querySelector('.lg-canvas').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
  const cx = Math.round(box.x + box.w / 2);
  const cy = Math.round(box.y + box.h / 2);
  // The hub centred (Space): Harbourline's whole vault frames from its cloud's edge.
  const s = await snap(H);
  const hub = s.nodes.filter((n) => n.x > 300 && n.y > 80 && n.x < s.view.w - 60 && n.y < s.view.h - 60).sort((a, b) => b.r - a.r)[0];
  const hxy = await H.browser.ev(`(() => { const r = document.querySelector('.lg-canvas').getBoundingClientRect(); return { x: Math.round(r.x + ${hub.x}), y: Math.round(r.y + ${hub.y}) }; })()`);
  await tap(H, hxy.x, hxy.y);
  await sleep(600);
  await key(H, ' ', 'Space', 32);
  await sleep(2500);
  const centred = await snap(H);
  assert.equal(centred.centre, hub.id, 'Space centres on the hub');
  const frame = centred.cam.k;
  await wheel(H, cx, cy, -240);
  await sleep(1500);
  const zin = await snap(H);
  assert.ok(Math.abs(zin.cam.k / frame - 1.1) < 0.06, `one notch in is 1.1x (${frame.toFixed(3)} to ${zin.cam.k.toFixed(3)})`);
  await wheel(H, cx, cy, 240);
  await sleep(1500);
  await wheel(H, cx, cy, 240);
  await sleep(1500);
  const out = await snap(H);
  assert.ok(out.cam.k <= frame * 1.05, `zooming out comes back to the frame (${zin.cam.k.toFixed(3)} to ${out.cam.k.toFixed(3)}, frame ${frame.toFixed(3)})`);
  assert.deepEqual(await errs(H).then((e) => e.slice(e0)), [], 'no page errors');
});

test('live: a taken camera survives leaving and coming back', { timeout: 600000 }, async () => {
  await boot(1600, 1000);
  // One tab to start from (tabs persist across boots): shut the rest with real clicks.
  for (let i = 0; i < 12 && (await titles(H)).length > 1; i++) {
    const x = await find(H, `[...document.querySelectorAll('.tab-item')].find(e=>!e.classList.contains('active'))?.querySelector('.tab-close')`);
    if (!x) break;
    await tap(H, x.x, x.y);
    await sleep(600);
  }
  assert.equal(await clickWords(H, 'More', '.sidebar.left, aside'), 'CLICKED', 'More opens');
  await sleep(600);
  assert.equal(await clickWords(H, 'Graph', '.menu, [role="menu"]'), 'CLICKED', 'Graph opens');
  await park(H);
  assert.ok(await waitFor(H, `window.__nvLivingGraph && window.__nvLivingGraph.snapshot().count > 100`), 'points draw');
  assert.ok(await waitFor(H, `window.__nvLivingGraph.snapshot().framed`, 90000), 'the vault settles');
  const e0 = (await errs(H)).length;
  const box = await H.browser.ev(`(() => { const r = document.querySelector('.lg-canvas').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
  const cx = Math.round(box.x + box.w / 2);
  const cy = Math.round(box.y + box.h / 2);
  for (let i = 0; i < 6; i++) {
    await wheel(H, cx, cy, -240);
    await sleep(120);
  }
  await sleep(1500);
  // Show everything on too: the legend switches ride with the camera.
  const sw = await find(H, `(function(){const els=[...document.querySelectorAll('label, span, button')].filter(e=>{const r=e.getBoundingClientRect();return r.width>2&&r.height>2});const t=els.find(e=>(e.innerText||'').trim()==='Show everything');if(!t) return null;return t.closest('label')||t})()`);
  assert.ok(sw, 'the Show everything switch shows');
  await tap(H, sw.x, sw.y);
  await sleep(2000);
  const before = await snap(H);
  const graphTitle = await H.browser.ev(`document.querySelector('.tab-item.active .tab-title')?.textContent`);
  // The note opens where the person is, Back returns (t239, 12 Nov): the taken camera and the legend
  // switches ride with the graph, whatever the way back.
  const t = before.nodes.filter((n) => n.x > 300 && n.y > 80 && n.x < before.view.w - 60 && n.y < before.view.h - 60).sort((a, b) => b.r - a.r)[0];
  const txy = await H.browser.ev(`(() => { const r = document.querySelector('.lg-canvas').getBoundingClientRect(); return { x: Math.round(r.x + ${t.x}), y: Math.round(r.y + ${t.y}) }; })()`);
  await tap(H, txy.x, txy.y, 1);
  await sleep(120);
  await tap(H, txy.x, txy.y, 2);
  assert.ok(await waitFor(H, `[...document.querySelectorAll('.tab-item.active .tab-title')].some((e) => e.textContent.includes(${JSON.stringify(t.title)}))`, 15000), 'the note opens where the person is');
  assert.ok(await waitFor(H, `!!document.querySelector('button[aria-label="Back"]')`, 10000), 'Back stands once the note lands');
  await H.browser.ev(`document.querySelector('button[aria-label="Back"]')?.click()`);
  assert.ok(await waitFor(H, `document.querySelector('.tab-item.active .tab-title')?.textContent === ${JSON.stringify(graphTitle)}`, 15000), 'Back returns to the graph tab');
  assert.ok(await waitFor(H, `window.__nvLivingGraph && window.__nvLivingGraph.snapshot().count > 100`, 15000), 'the graph draws again');
  await sleep(2500);
  const back = await snap(H);
  assert.ok(Math.abs(back.cam.k - before.cam.k) < 1e-9 && Math.abs(back.cam.cx - before.cam.cx) < 1e-9 && Math.abs(back.cam.cy - before.cam.cy) < 1e-9, `the taken camera survives (k ${before.cam.k.toFixed(2)} to ${back.cam.k.toFixed(2)})`);
  assert.equal(back.count, before.count, 'show-everything rides along');
  const checked = await H.browser.ev(`(function(){const els=[...document.querySelectorAll('label')].filter(e=>{const r=e.getBoundingClientRect();return r.width>2&&r.height>2});const t=els.find(e=>(e.innerText||'').trim()==='Show everything');return t?.querySelector('input[type=checkbox]')?.checked ?? null})()`);
  assert.equal(checked, true, 'the switch stays on');
  assert.deepEqual(await errs(H).then((e) => e.slice(e0)), [], 'no page errors');
});

test('live: every More submenu opens at its own row, by mouse and keys', { timeout: 600000 }, async () => {
  const mods = Object.fromEntries(['health', 'family', 'finance', 'documents', 'house', 'vehicles', 'career', 'travel'].map((id) => [id, { on: true }]));
  await boot(1219, 709, { modules: mods });
  const e0 = (await errs(H)).length;
  await openMore();
  const subs = (await menuRows(0)).filter((r) => r.sub && !r.disabled).map((r) => r.label);
  assert.ok(subs.length >= 3, `folded groups show as submenu rows (${subs.join(', ')})`);
  // By hover and by click, each opens beside its own row (below it, or flipped just above it).
  for (const label of subs) {
    await openMore();
    const row = (await menuRows(0)).find((r) => r.label === label);
    await H.browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(row.x), y: Math.round(row.y), button: 'none' });
    await sleep(700);
    let levels = await H.browser.ev(`document.querySelectorAll('.menu').length`);
    assert.equal(levels, 2, `hovering ${label} opens its submenu`);
    const near = async () => {
      const m = await H.browser.ev(`(function(){
        const ms = [...document.querySelectorAll('.menu')].filter(e=>e.getBoundingClientRect().width>2);
        if (ms.length < 2) return null;
        const r = ms[1].getBoundingClientRect();
        const row = [...ms[0].querySelectorAll(':scope > .menu-row')].find((e) => e.querySelector('.menu-label').innerText === ${JSON.stringify(label)});
        const b = row.getBoundingClientRect();
        return { subTop: Math.round(r.top), subBottom: Math.round(r.bottom), rowTop: Math.round(b.top) };
      })()`);
      return Math.min(Math.abs(m.subTop - m.rowTop), Math.abs(m.subBottom - m.rowTop));
    };
    // Beside its row (the -5 anchor and -4 flip offsets part them by 9 at most when flipped above).
    assert.ok((await near()) <= 12, `${label} opens at its own row`);
    await esc(H);
    await sleep(500);
    await openMore();
    const row2 = (await menuRows(0)).find((r) => r.label === label);
    await tap(H, row2.x, row2.y);
    await sleep(700);
    levels = await H.browser.ev(`document.querySelectorAll('.menu').length`);
    assert.equal(levels, 2, `clicking ${label} opens its submenu`);
    assert.ok((await near()) <= 12, `${label} sits at its own row`);
    await esc(H);
    await sleep(500);
  }
  // By keyboard: Right opens each (the last one too), arrows walk it fully, Left puts it away.
  for (const label of subs) {
    await openMore();
    for (let i = 0; i < 20; i++) {
      const cur = await H.browser.ev(`document.querySelector('.menu .menu-row.selected .menu-label')?.innerText ?? ''`);
      if (cur === label) break;
      await arrow(H, 'Down');
      await sleep(180);
    }
    assert.equal(await H.browser.ev(`document.querySelector('.menu .menu-row.selected .menu-label')?.innerText ?? ''`), label, `arrows reach ${label}`);
    await arrow(H, 'Right');
    await sleep(700);
    assert.equal(await H.browser.ev(`document.querySelectorAll('.menu').length`), 2, `Right opens ${label}`);
    const want = (await menuRows(1)).filter((r) => !r.disabled).map((r) => r.label);
    assert.ok(want.length > 0, `${label} holds rows`);
    const seen = [];
    for (let i = 0; i < want.length + 1; i++) {
      await arrow(H, 'Down');
      await sleep(180);
      seen.push(await H.browser.ev(`(function(){const ms=[...document.querySelectorAll('.menu')];return ms[1]?.querySelector('.menu-row.selected .menu-label')?.innerText ?? ''})()`));
    }
    for (const t of want) assert.ok(seen.includes(t), `arrows reach ${label} › ${t}`);
    await arrow(H, 'Left');
    await sleep(500);
    assert.equal(await H.browser.ev(`document.querySelectorAll('.menu').length`), 1, 'Left puts the submenu away');
    await esc(H);
    await sleep(500);
  }
  assert.deepEqual(await errs(H).then((e) => e.slice(e0)), [], 'no page errors');
});

test('live: More fits the window at 1219x709 and 3456x1408, even with 5 pins and 8 packs', { timeout: 600000 }, async () => {
  const mods = Object.fromEntries(['health', 'family', 'finance', 'documents', 'house', 'vehicles', 'career', 'travel'].map((id) => [id, { on: true }]));
  const pins = [
    { id: 'p1', type: 'file', path: 'Work/Work note 3.md', title: 'Work note 3' },
    { id: 'p2', type: 'folder', path: 'Work/Harbourline', title: 'Harbourline' },
    { id: 'p3', type: 'file', path: 'Me/Me note 7.md', title: 'A much longer pinned note title here' },
    { id: 'p4', type: 'file', path: 'Business/Business note 2.md', title: 'Business note 2' },
    { id: 'p5', type: 'file', path: 'Home/Home note 1.md', title: 'Home note 1' },
  ];
  // The break case: 5 pins, hidden rows, 8 packs at 1219x709 - it scrolled and ran 74px past.
  await boot(1219, 709, { modules: mods, hidden: ['ribbon:timeline', 'ribbon:automations', 'ribbon:daily', 'ribbon:canvas', 'ribbon:recovery'] }, pins);
  const e0 = (await errs(H)).length;
  await openMore();
  const m = await H.browser.ev(`(function(){
    const el = [...document.querySelectorAll('.menu')].find((e) => e.getBoundingClientRect().width > 2);
    const r = el.getBoundingClientRect();
    const rows = [...el.querySelectorAll(':scope > .menu-row, :scope > .menu-heading')].map((e) => Math.round(e.getBoundingClientRect().bottom));
    return { scrollH: el.scrollHeight, clientH: el.clientHeight, bottom: Math.round(r.bottom), lastRow: Math.max(...rows), vh: window.innerHeight };
  })()`);
  assert.ok(m.scrollH <= m.clientH + 1, `nothing scrolls (${m.scrollH} over ${m.clientH})`);
  assert.ok(m.lastRow <= m.vh, `no row past the window (${m.lastRow} over ${m.vh})`);
  const labels = (await menuRows(0)).map((r) => r.label);
  assert.ok(labels.includes('Pinned'), `the pins fold behind one row (${labels.join(' · ')})`);
  const pinned = (await menuRows(0)).find((r) => r.label === 'Pinned');
  assert.ok(pinned.sub, 'Pinned keeps its rows in a submenu');
  await tap(H, pinned.x, pinned.y);
  await sleep(700);
  assert.equal(await H.browser.ev(`document.querySelectorAll('.menu').length`), 2, 'Pinned opens');
  const pinRows = (await menuRows(1)).map((r) => r.label);
  assert.deepEqual(pinRows, ['Work note 3', 'Harbourline', 'A much longer pinned note title here', 'Business note 2', 'Home note 1'], 'every pin behind it');
  const pin = (await menuRows(1))[0];
  await tap(H, pin.x, pin.y);
  await sleep(1500);
  assert.ok((await titles(H)).some((t) => t.includes('Work note 3')), `a pin opens its file (${(await titles(H)).join(' / ')})`);
  // The settle no longer sinks menus: nothing past the window's edge at either size.
  await boot(1219, 709, { modules: mods });
  await openMore();
  const small = await H.browser.ev(`(function(){const el=[...document.querySelectorAll('.menu')].find((e)=>e.getBoundingClientRect().width>2);return { bottom: Math.round(el.getBoundingClientRect().bottom), vh: window.innerHeight };})()`);
  assert.ok(small.bottom <= small.vh - 8, `the menu ends inside 1219x709 (${small.bottom} over ${small.vh - 8})`);
  await boot(3456, 1408, {});
  await openMore();
  const big = await H.browser.ev(`(function(){const el=[...document.querySelectorAll('.menu')].find((e)=>e.getBoundingClientRect().width>2);return { bottom: Math.round(el.getBoundingClientRect().bottom), vh: window.innerHeight };})()`);
  assert.ok(big.bottom <= big.vh - 8, `the menu ends inside 3456x1408 (${big.bottom} over ${big.vh - 8})`);
  assert.deepEqual(await errs(H).then((e) => e.slice(e0)), [], 'no page errors');
});

test('live: every More row opens what it says, folded submenus included', { timeout: 600000 }, async () => {
  const mods = Object.fromEntries(['health', 'family', 'finance', 'documents', 'house', 'vehicles', 'career', 'travel'].map((id) => [id, { on: true }]));
  await boot(3456, 1408, { modules: mods }, [
    { id: 'p1', type: 'file', path: 'Work/Work note 3.md', title: 'Work note 3' },
    { id: 'p2', type: 'folder', path: 'Work/Harbourline', title: 'Harbourline' },
  ]);
  const e0 = (await errs(H)).length;
  const stateSig = () => H.browser.ev(`(function(){
    const tabs = [...document.querySelectorAll('.tab-item .tab-title')].map(e=>e.textContent).join('|');
    const active = document.querySelector('.tab-item.active .tab-title')?.textContent ?? '';
    return tabs + '#' + active + '#' + !!document.querySelector('.modal, [role="dialog"]');
  })()`);
  const activeShows = (label) => H.browser.ev(`(document.querySelector('.tab-item.active .tab-title')?.textContent ?? '').includes(${JSON.stringify(label.replace(/…$/, ''))})`);
  // Every top row plus every row of every submenu (folded groups keep pack, kind and chooser rows).
  await openMore();
  const plan = [];
  for (const r of (await menuRows(0)).filter((r) => !r.disabled)) {
    if (!r.sub) plan.push({ label: r.label });
    else {
      await H.browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(r.x), y: Math.round(r.y), button: 'none' });
      await sleep(600);
      for (const s of (await menuRows(1)).filter((s) => !s.disabled)) {
        if (!s.sub) plan.push({ label: s.label, via: r.label });
        else {
          await H.browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(s.x), y: Math.round(s.y), button: 'none' });
          await sleep(600);
          for (const t of (await menuRows(2)).filter((t) => !t.disabled && !t.sub)) plan.push({ label: t.label, via: r.label, via2: s.label });
          await esc(H);
          await sleep(400);
          await openMore();
          await H.browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(r.x), y: Math.round(r.y), button: 'none' });
          await sleep(600);
        }
      }
      await esc(H);
      await sleep(400);
    }
  }
  assert.ok(plan.length > 30, `the sweep covers every row (${plan.length})`);
  assert.ok(plan.some((p) => p.via === 'Packs and kinds'), 'the folded packs rows are swept');
  const quiet = ['Open a file from this PC…', 'Import CSV…'];
  const failed = [];
  for (const v of plan) {
    await openMore();
    let target;
    if (!v.via) target = (await menuRows(0)).find((r) => r.label === v.label);
    else {
      const top = (await menuRows(0)).find((r) => r.label === v.via);
      await H.browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(top.x), y: Math.round(top.y), button: 'none' });
      await sleep(600);
      if (!v.via2) target = (await menuRows(1)).find((r) => r.label === v.label);
      else {
        const mid = (await menuRows(1)).find((r) => r.label === v.via2);
        await H.browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(mid.x), y: Math.round(mid.y), button: 'none' });
        await sleep(600);
        target = (await menuRows(2)).find((r) => r.label === v.label);
      }
    }
    if (!target) {
      failed.push(`${v.label} (gone)`);
      await esc(H);
      continue;
    }
    const before = await stateSig();
    await tap(H, target.x, target.y);
    let after = before;
    for (let i = 0; i < 40 && after === before; i++) {
      await sleep(250);
      after = await stateSig();
    }
    // Tabs persist across boots, so a row whose file is already showing reactivates it instead of
    // changing the set: it still opens what it says.
    if (before === after && !quiet.includes(v.label) && !(await activeShows(v.label))) failed.push(v.label);
    if (await H.browser.ev(`!!document.querySelector('.modal, [role="dialog"]')`)) {
      await esc(H);
      await sleep(600);
    }
  }
  assert.deepEqual(failed, [], `every row opens what it says (${plan.length} rows)`);
  assert.deepEqual(await errs(H).then((e) => e.slice(e0)), [], 'no page errors');
});
