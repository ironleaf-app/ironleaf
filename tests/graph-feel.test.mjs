// node --test tests/graph-feel.test.mjs - the graph's feel (9 Nov 2026, on 10.1.7): map-like zoom (about 1.1x
// per wheel notch, eased toward the pointer, between the fitted vault and 4x), fixed-size text at every zoom
// (labels, tags and card stay put while only the space between points grows), a clean centre id from every tab
// (the doubled `person:person:` id fixed at its cause), a graph alive at rest (visible drift, an ambient pulse,
// gentle hover), and click feel - each proven with real CDP input events, never synthetic page events.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startHarness } from './vault-controls-harness.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const work = mkdtempSync(path.join(tmpdir(), 'nv-graph-feel-'));
let L;
let P;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  await build({ input: path.join(root, 'src/shared/living-graph.ts'), platform: 'node', output: { file: path.join(work, 'l.mjs'), format: 'esm' }, logLevel: 'silent' });
  L = await import(pathToFileURL(path.join(work, 'l.mjs')).href);
  await build({ input: path.join(root, 'src/shared/people.ts'), platform: 'node', output: { file: path.join(work, 'p.mjs'), format: 'esm' }, logLevel: 'silent' });
  P = await import(pathToFileURL(path.join(work, 'p.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

// A person's tab never doubles its marker, however often the id passes through (9 Nov 2026: PersonCard.id
// already carries `person:`, and openPerson added it again - every person tab read `person:person:…`).
test('a person tab carries one marker: openPerson is idempotent, old doubled tabs heal to the same record', () => {
  assert.equal(P.personTabPath('person:alex chen'), 'person:alex chen', 'a record id passes through whole');
  assert.equal(P.personTabPath('alex chen'), 'person:alex chen', 'a bare key gains the one marker');
  assert.equal(P.personTabPath('person:person:alex chen'), 'person:alex chen', 'a doubled id collapses');
  assert.equal(P.personTabPath('org:acme'), 'person:org:acme', 'an organisation keeps its page under the people tab');
  assert.equal(P.personRecordIdOfTab('person:alex chen'), 'person:alex chen', 'a clean tab yields its record');
  assert.equal(P.personRecordIdOfTab('person:person:alex chen'), 'person:alex chen', 'an old doubled tab heals to the same record');
  assert.equal(P.personRecordIdOfTab('person:org:acme'), 'org:acme', 'an organisation tab yields its record');
});

// Every door that opens a centred graph passes a clean id: a note, a person, a project, a meeting, a link's
// row - anything else opens the whole vault rather than centring on nothing.
test('Ctrl+G resolves every tab to a clean centre id or the whole vault', () => {
  const ctx = { projectInFolder: (f) => (f === 'Projects/Harbourline' ? 'Projects/Harbourline/Harbourline.md' : null) };
  const c = (type, p) => L.graphCentreForTab({ type, ...(p === undefined ? {} : { path: p }) }, ctx);
  assert.equal(c('note', 'Work/Plan.md'), 'Work/Plan.md', 'a note centres on itself');
  assert.equal(c('media', 'Assets/logo.png'), 'Assets/logo.png', 'a file centres on itself');
  assert.equal(c('canvas', 'Boards/Map.canvas'), 'Boards/Map.canvas', 'a canvas centres on itself');
  assert.equal(c('note', 'Projects/Harbourline/Harbourline.md'), 'Projects/Harbourline/Harbourline.md', 'a project page is its note');
  assert.deepEqual(c('people', 'person:person:alex chen'), { person: 'person:alex chen' }, 'a person resolves through their card, doubled or not');
  assert.deepEqual(c('people', 'person:alex chen'), { person: 'person:alex chen' }, 'a clean person tab resolves the same way');
  assert.equal(c('notebook', 'notebook:Projects/Harbourline'), 'Projects/Harbourline/Harbourline.md', 'a project workspace centres on its project file');
  assert.equal(c('notebook', 'notebook:Work'), null, 'a folder with no project opens whole');
  assert.equal(c('meetings', `meetings:#meeting:${encodeURIComponent('Meetings/Standup.md')}`), 'Meetings/Standup.md', 'a meeting unwraps to its note');
  assert.equal(c('module', `module:systems#machines:${encodeURIComponent('Machines.md#m1')}`), 'Machines.md', 'a linked row centres on its list');
  assert.equal(c('module', `module:finance#bill:${encodeURIComponent('Bills.md#b2')}`), 'Bills.md', 'a linked bill centres on its list');
  assert.equal(c('graph', 'Work/Plan.md'), null, 'from the graph itself it steps back out');
  assert.equal(c('people', undefined), null, 'a list opens whole');
  assert.equal(c('settings', undefined), null, 'a placeless tab opens whole');
  assert.equal(c('loose', 'C:\\Temp\\note.md'), null, 'a file outside the vault opens whole');
  assert.equal(c('module', 'module:family#person:Bob'), null, 'a module part naming no file opens whole');
  assert.equal(c('type', 'type:task'), null, 'a type page opens whole');
});

// About 1.1x per wheel notch (five notches ≈ 1.6x), gentle for small trackpad and pinch deltas - one formula,
// no per-device cases. In to 4x, out to the fitted vault, never past either.
test('a wheel notch zooms about 1.1x, small deltas gently', () => {
  assert.equal(L.LIVING_ZOOM_MAX, 4, 'in to 4x, not 8');
  assert.ok(Math.abs(L.livingWheelFactor(-240) - 1.1) < 1e-9, 'one notch in is 1.1x');
  const five = Math.pow(L.livingWheelFactor(-240), 5);
  assert.ok(five > 1.55 && five < 1.67, `five notches total about 1.6x (${five.toFixed(3)})`);
  assert.ok(Math.abs(L.livingWheelFactor(240) - 1 / 1.1) < 1e-9, 'one notch out mirrors it');
  const small = L.livingWheelFactor(-12);
  assert.ok(small > 1 && small < 1.02, `a small trackpad delta barely moves (${small.toFixed(4)})`);
  assert.equal(L.livingWheelFactor(0), 1, 'no delta is no zoom');
});

test('wiring: eased wheel zoom through the shared factor, screen-space words, hover that never fires', () => {
  const engine = read('src/renderer/src/lib/living-engine.ts');
  assert.ok(engine.includes('livingWheelFactor('), 'the wheel zooms through the shared factor');
  assert.ok(engine.includes('LIVING_ZOOM_MAX'), 'the zoom-in cap is shared, not a stray literal');
  assert.ok(engine.includes('zoomGoal'), 'a wheel notch eases toward its goal instead of jumping');
  assert.ok(/private drawWords[\s\S]*?setTransform\(this\.dsf, 0, 0, this\.dsf, 0, 0\)/.test(engine), 'labels and tags draw in screen space, fixed at every zoom');
  const move = /private move\(e: PointerEvent\)[\s\S]*?\n  \}/.exec(engine)?.[0] ?? '';
  assert.ok(!move.includes('this.fire('), 'a hover brightens but never fires (clicks fire)');
  assert.ok(read('src/renderer/src/state/actions.ts').includes('graphCentreForTab('), 'Ctrl+G resolves through the shared centre ids');
  assert.ok(read('src/renderer/src/views/PeoplePage.tsx').includes('personTabPath('), 'a person tab is built idempotently');
  assert.ok(read('src/renderer/src/views/PersonPage.tsx').includes('personRecordIdOfTab('), 'a person page reads the healed record id');
  assert.ok(read('src/renderer/src/state/workspace.ts').includes("t.type === 'graph' && t.path"), 'a restored graph on a gone note opens whole');
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
const snap = (h) => h.browser.ev(`window.__nvLivingGraph.snapshot()`);

test('live: real wheel, pan, drag, click and Ctrl+G feel right on the real client', { timeout: 600000 }, async () => {
  const h = await startHarness();
  try {
    await h.services.invoke('settings:update', [{ prefs: { showTabs: true } }]);
    await h.browser.send('Page.navigate', { url: `${h.origin}/harness.html?graph=living` });
    for (let i = 0; i < 90; i++) {
      await sleep(500);
      try {
        if (await h.browser.ev(`!!document.querySelector('.app')`)) break;
      } catch {}
    }
    await sleep(2000);
    await openRoom(h, 'Graph');
    // Room to zoom and pan without losing every point off the edge of a small default viewport.
    await h.browser.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
    await sleep(1200);
    assert.ok(await waitFor(h, `window.__nvLivingGraph && window.__nvLivingGraph.snapshot().count > 0`), 'points draw');
    assert.ok(await waitFor(h, `window.__nvLivingGraph.snapshot().framed`, 90000), 'the vault settles');
    const ALEX = 'People/Alex Chen.md';
    const MAIN = '.nj-graph-body .lg-canvas';
    const titles = () => h.browser.ev(`[...document.querySelectorAll('.tab-item .tab-title')].map((e) => e.textContent)`);
    const point = async (id) => {
      const s = await snap(h);
      const t = s.nodes.find((x) => x.id === id);
      assert.ok(t, `${id} is a point`);
      return t;
    };
    const at = async (t, canvasSel) => {
      const box = await h.browser.ev(`(() => { const r = document.querySelector(${JSON.stringify(canvasSel)}).getBoundingClientRect(); return { x: r.x, y: r.y }; })()`);
      return { x: Math.round(box.x + t.x), y: Math.round(box.y + t.y) };
    };
    const tap = async (x, y, count = 1, mods = 0) => {
      await h.browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: count, modifiers: mods });
      await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: count, modifiers: mods });
    };
    const ctrlG = async () => {
      await h.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'g', code: 'KeyG', windowsVirtualKeyCode: 71, modifiers: 2 });
      await h.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'g', code: 'KeyG', windowsVirtualKeyCode: 71, modifiers: 2 });
    };
    // Five wheel notches zoom about 1.6x in total, toward the pointer - never to the cap.
    const before = await snap(h);
    assert.ok(before.labels.length > 0, `labels rest on the page (${before.labels.length})`);
    const box = await h.browser.ev(`(() => { const r = document.querySelector(${JSON.stringify(MAIN)}).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
    const cx = Math.round(box.x + box.w / 2);
    const cy = Math.round(box.y + box.h / 2);
    for (let i = 0; i < 5; i++) {
      await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: cx, y: cy, deltaX: 0, deltaY: -240 });
      await sleep(120);
    }
    await sleep(1400);
    const zoomed = await snap(h);
    const ratio = zoomed.cam.k / before.cam.k;
    assert.ok(ratio > 1.4 && ratio < 1.85, `five notches zoom about 1.6x in total (${ratio.toFixed(2)}x)`);
    assert.ok(zoomed.cam.k < 3.8, `five notches stay clear of the 4x cap (k=${zoomed.cam.k.toFixed(2)})`);
    // Labels measure the same pixel size before and after the zoom; only the space between points grows.
    const bw = new Map(before.labels.map((l) => [l.id, l]));
    const common = zoomed.labels.filter((l) => bw.has(l.id));
    assert.ok(common.length > 0, 'a label survives the zoom to measure');
    for (const l of common.slice(0, 6)) {
      const o = bw.get(l.id);
      assert.ok(Math.abs(l.w - o.w) <= 1 && Math.abs(l.h - o.h) <= 1, `${l.id} measures the same pixels (${Math.round(o.w)}x${Math.round(o.h)} to ${Math.round(l.w)}x${Math.round(l.h)})`);
    }
    const spread = (s) => {
      const xs = s.nodes.map((n) => n.x);
      return Math.max(...xs) - Math.min(...xs);
    };
    assert.ok(spread(zoomed) > spread(before) * 1.3, 'the space between points grows');
    // And back out again: five notches out return to the fitted view.
    for (let i = 0; i < 5; i++) {
      await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: cx, y: cy, deltaX: 0, deltaY: 240 });
      await sleep(120);
    }
    await sleep(1400);
    const back0 = await snap(h);
    const outRatio = back0.cam.k / before.cam.k;
    assert.ok(outRatio > 0.9 && outRatio < 1.1, `five notches out return to the fit (${outRatio.toFixed(2)}x)`);
    // A drag across empty canvas pans by the dragged distance.
    const es = await snap(h);
    const cands = [{ x: es.view.w - 120, y: es.view.h - 120 }, { x: es.view.w - 120, y: 120 }, { x: 340, y: es.view.h - 120 }, { x: es.view.w / 2, y: es.view.h - 80 }];
    const empty = cands.find((c) => es.nodes.every((n) => Math.hypot(n.x - c.x, n.y - c.y) > 40)) ?? cands[0];
    const g0 = await at(empty, MAIN);
    const n0 = new Map((await snap(h)).nodes.map((n) => [n.id, n]));
    await h.browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: g0.x, y: g0.y, button: 'left', clickCount: 1 });
    for (let i = 1; i <= 10; i++) {
      await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: g0.x - i * 30, y: g0.y - i * 15, button: 'left', buttons: 1 });
      await sleep(30);
    }
    await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: g0.x - 300, y: g0.y - 150, button: 'left', clickCount: 1 });
    await sleep(600);
    const n1 = new Map((await snap(h)).nodes.map((n) => [n.id, n]));
    const deltas = [...n0].map(([id, a]) => Math.hypot(n1.get(id).x - a.x + 300, n1.get(id).y - a.y + 150));
    assert.ok(Math.min(...deltas) < 14, `a drag pans by the dragged distance (nearest off by ${Math.min(...deltas).toFixed(1)}px)`);
    // One click selects and fires at once, with its card (whatever the pan left tappable).
    const tappable = async (avoid = []) => {
      const s = await snap(h);
      const c = s.nodes
        .filter((n) => n.x > 260 && n.y > 60 && n.x < s.view.w - 40 && n.y < s.view.h - 40 && !avoid.includes(n.id))
        .sort((a, b) => b.r - a.r)[0];
      assert.ok(c, `a point sits tappable after the pan (${s.nodes.map((n) => `${n.title}:${Math.round(n.x)},${Math.round(n.y)}`).join(' ')})`);
      return c;
    };
    const clickee = await tappable();
    const hxy = await at(clickee, MAIN);
    await tap(hxy.x, hxy.y);
    const picked = await snap(h);
    assert.equal(picked.selected, clickee.id, 'one click selects');
    assert.ok(picked.pulses > 0, `its links fire at once (${picked.pulses} pulses)`);
    assert.ok(await waitFor(h, `((document.querySelector('.nj-graph-body .lg-card') || {}).innerText || '').includes('Open')`, 5000), 'the card shows by the point');
    // A hover brightens but fires nothing; dragging a point pulls it, and it settles back.
    const hoveree = await tappable([clickee.id]);
    const axy = await at(hoveree, MAIN);
    await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: axy.x, y: axy.y });
    await sleep(800);
    const hovered = await snap(h);
    assert.equal(hovered.hovered, hoveree.id, 'the hover lands');
    assert.equal(hovered.pulses, 0, 'but nothing travels until the click');
    const dragFrom = await point(hoveree.id);
    const dxy = await at(dragFrom, MAIN);
    await h.browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: dxy.x, y: dxy.y, button: 'left', clickCount: 1 });
    for (let i = 1; i <= 6; i++) {
      await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: dxy.x + i * 10, y: dxy.y, button: 'left', buttons: 1 });
      await sleep(60);
    }
    const dragged = await point(hoveree.id);
    assert.ok(Math.hypot(dragged.x - dragFrom.x, dragged.y - dragFrom.y) > 30, 'dragging a point pulls it along');
    await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: dxy.x + 60, y: dxy.y, button: 'left', clickCount: 1 });
    await sleep(4000);
    const back = await point(hoveree.id);
    assert.ok(Math.hypot(back.x - dragFrom.x, back.y - dragFrom.y) < 50, 'it settles back where it was');
    assert.ok(Math.hypot(back.x - dragged.x, back.y - dragged.y) > 10, 'it visibly comes back from the drag');
    // At rest the network breathes, and a pulse crosses now and then.
    await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(box.x + 30), y: Math.round(box.y + box.h - 30) });
    await sleep(300);
    const r1 = await snap(h);
    await sleep(2200);
    const r2 = await snap(h);
    const drifted = Math.max(...r1.nodes.map((a) => {
      const b = r2.nodes.find((n) => n.id === a.id);
      return b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
    }));
    assert.ok(drifted > 1.5, `the network visibly breathes at rest (${drifted.toFixed(1)}px)`);
    let fired = false;
    for (let i = 0; i < 36 && !fired; i++) {
      await sleep(250);
      try {
        fired = (await snap(h)).pulses > 0;
      } catch {}
    }
    assert.ok(fired, 'a soft pulse crosses every few seconds');
    // Double-click opens; Ctrl+G from the note centres back on it.
    const openee = await tappable();
    const oxy = await at(openee, MAIN);
    await tap(oxy.x, oxy.y, 1);
    await sleep(120);
    await tap(oxy.x, oxy.y, 2);
    assert.ok(await waitFor(h, `[...document.querySelectorAll('.tab-item.active .tab-title')].some((e) => e.textContent.includes(${JSON.stringify(openee.title)}))`, 10000), `double-click opens ${openee.title}`);
    await sleep(800);
    await ctrlG();
    assert.ok(await waitFor(h, `window.__nvLivingGraph.snapshot().centre === ${JSON.stringify(openee.id)}`, 10000), 'Ctrl+G from the note centres on it');
    assert.ok((await titles()).some((t) => t.includes(`Connections: ${openee.title}`)), 'the tab says whose connections');
    // Ctrl+G from a person's page centres on that person - one clean id, never doubled.
    await openRoom(h, 'People');
    assert.equal(await clickWords(h, 'Alex Chen'), 'CLICKED', 'Alex Chen opens');
    assert.ok(await waitFor(h, `document.body.innerText.includes('Alex Chen')`, 10000), 'their page shows');
    assert.ok(!(await h.browser.ev(`document.body.innerText.includes("Couldn't check")`)), 'their card reads');
    await sleep(800);
    await ctrlG();
    assert.ok(await waitFor(h, `window.__nvLivingGraph.snapshot().centre === ${JSON.stringify(ALEX)}`, 15000), 'Ctrl+G from the person centres on them');
    assert.ok((await titles()).some((t) => t.includes('Connections: Alex Chen')), `the tab names them (${(await titles()).join(' / ')})`);
    assert.ok(!(await titles()).some((t) => t.includes('person:')), 'no doubled id anywhere in the tabs');
  } finally {
    await h.close().catch(() => {});
  }
});
