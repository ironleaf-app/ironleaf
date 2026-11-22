// node --test tests/wide-rooms-3456.test.mjs — every Vault page at the window (a window of
// 3456x1408): room pages stood in a 1080px column at every size, so at 3456 the words sat as a narrow
// island with ~1040px of dead space each side, and the project folio held at 1120. The column now widens
// with the window through the one shared variable every room already stands in (--page-max: 1280 past
// 1700px viewports, the same ultra measure as the former host app's --ns-reading-ultra at the same
// breakpoint, then 2400 past 2400px — t254, 13 Nov 2026, replacing the 1440 that left 862 dead pixels
// each side) and the folio steps with the rooms; Rings (t82, in place of the living graph) fills the
// page with its legend over it, whole or centred. Reading pages (.read, 920px), boards and full-width
// views keep their own widths; below 1700px nothing changes. Each check fails without its rule (rooms
// render 1080 at every size, the graph canvas misses the page).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import { openSettings, startHarness } from './vault-controls-harness.mjs';

const root = path.join(import.meta.dirname, '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Static: the shared mechanism ─────────────────────────────────────────────
// The wide-window steps ride at the end of their sheets (scoped additions, not rewrites).

test('rooms take the frame through the one shared variable', () => {
  // Layout round 2 (compose.css, 20 Nov 2026): composed, not centred. Every room's frame starts at one left edge and
  // takes the room; compose.css, loaded last of the width sheets, sets the shared --page-max to 100%, so the older
  // 1080/1280/2400 steps (polish-shell.css) and the --w-content column (page-frame.css) give way.
  const compose = read('src/renderer/src/styles/compose.css');
  assert.ok(/:root\s*\{[^}]*--page-max:\s*100%/s.test(compose), 'the rooms take the room');
  const main = read('src/renderer/src/main.tsx');
  const at = (f) => main.indexOf(`import './styles/${f}';`);
  assert.ok(at('compose.css') > at('polish-shell.css') && at('compose.css') > at('page-frame.css') && at('page-frame.css') > 0, 'compose.css loads after the older width sheets');
  const frame = read('src/renderer/src/styles/page-frame.css');
  assert.ok(frame.includes('max-width: var(--page-max)'), 'page-frame.css still routes every room through the variable');
});

test('reading pages stay narrow at every size', () => {
  const frame = read('src/renderer/src/styles/page-frame.css');
  assert.ok(/\.nv-page\.read\s*\{[^}]*max-width:\s*var\(--page-read\)/s.test(frame), 'reading pages keep --page-read');
  // 20 Nov 2026: the reading measure is the named --w-reading (720 px of text) plus the frame's gutters.
  assert.ok(/--w-reading:\s*720px/.test(frame) && /--page-read:\s*calc\(var\(--w-reading\) \+ 2 \* var\(--page-pad-side\)\)/.test(frame), 'the reading measure stands');
});

test('the shared explainer paragraph keeps its own cap on wide windows', () => {
  // The rooms widen but their words must not run on: .vsub (every pack's Fills itself line) would span the
  // 1440 column in ~170-character lines. Past 1700px viewports it holds at 76ch, the codebase's own prose
  // measure; narrow windows keep the full column.
  const kit = read('src/renderer/src/styles/kit.css');
  const at = kit.indexOf('@media (min-width: 1700px)');
  assert.ok(at > 0, 'the prose cap starts past 1700px viewports');
  assert.ok(/\.vsub \{[^}]*max-width: 76ch/s.test(kit.slice(at)), 'the explainer holds at 76ch');
});

test('the project folio steps with the rooms instead of holding at 1120', () => {
  const w2a = read('src/renderer/src/styles/w2a.css');
  assert.ok(w2a.includes('.vpage.wide.pj-folio { max-width: 980px'), 'narrow windows keep the 980 folio');
  assert.ok(/@container pj \(min-width: 1400px\)\s*\{[^}]*\.vpage\.wide\.pj-folio \{ max-width: 1280px/s.test(w2a), 'a roomy folio joins the 1280 rooms');
  // t242 (12 Nov, "no white oceans", the same direction as the approved Today 2000): the widest folio
  // reads 2080 with side columns instead of joining the 1440 rooms.
  assert.ok(/@container pj \(min-width: 2000px\)\s*\{[^}]*\.vpage\.wide\.pj-folio \{ max-width: 2080px; display: grid/s.test(w2a), 'the widest folio reads 2080 with side columns');
});

test('the rings graph fills the page and its legend holds its width (Rings the default, t82)', () => {
  const css = read('src/renderer/src/styles/brain-graph.css');
  assert.ok(/\.bg-canvas \{[^}]*position: absolute; inset: 0/s.test(css), 'the canvas fills the page at every size');
  assert.ok(/\.bg-legend \{[^}]*width: 196px/s.test(css), 'the legend holds its width');
  const at = css.indexOf('@media (min-width: 1700px)');
  assert.ok(at > 0, 'the wide hold starts past 1700px viewports');
  assert.ok(/\.bg-legend \{[^}]*width: 196px/s.test(css.slice(at)), 'past 1700px the legend still holds 196');
  assert.ok(css.includes('.bg.compact .bg-legend'), 'the note’s side graph keeps no legend');
  assert.ok(!/\.gm-/.test(css), 'no card-map selector survives');
  // The retired living graph keeps its fill behind its dev-only door.
  const living = read('src/renderer/src/styles/graph.css');
  assert.ok(/\.lg-canvas \{[^}]*position: absolute; inset: 0/s.test(living), 'the retired graph still fills behind its door');
});

test('the centred trio is gone; the graph body still gives the canvas the page', () => {
  const css = read('src/renderer/src/styles/page-states-87.css');
  assert.ok(!css.includes('w4b-map'), 'no trio rule survives');
  const shell = read('src/renderer/src/styles/notes-inbox-search-graph.css');
  assert.ok(/\.nj-graph-body \{[^}]*display: flex/s.test(shell), 'the body hands the canvas the page');
});

// ── Live: one boot, the rooms measured at 3456 wide and the middle one ───

let H = null;
async function harness() {
  if (!H) {
    H = await startHarness();
    await H.services.invoke('settings:update', [{ prefs: { modules: Object.fromEntries(['finance', 'goals', 'meetings'].map((id) => [id, { on: true }])) } }]);
    await H.browser.send('Page.navigate', { url: `${H.origin}/harness.html` });
    for (let i = 0; i < 90; i++) {
      await sleep(500);
      try {
        if (await H.browser.ev(`!!document.querySelector('.app')`)) break;
      } catch {}
    }
    await sleep(2000);
  }
  return H;
}
after(async () => {
  await H?.close().catch(() => {});
  H = null;
});

const SEL = 'button, a[href], select, input, textarea, [role="button"], [role="tab"], [role="menuitem"], summary';
async function clickWords(h, words, scope = '') {
  return h.browser.ev(`(async () => {
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
  // Settings lives in the account menu (the chip at the sidebar's foot), not as a sidebar row.
  if (name === 'Settings' && (await openSettings(h)) === 'CLICKED') return;
  // t10 the quiet More (8 Nov 2026): packs left the side bar and More for Ctrl+K, each by its own name.
  if ((await clickWords(h, name, '.sidebar.left, aside')) === 'CLICKED') return;
  // Command-backed rooms answer by their command's name (t10: each command named once).
  const label = name === 'Shared spaces' ? 'Open Shared spaces' : name === 'Graph' ? 'Open the graph' : name;
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75 });
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75 });
  if (!(await waitFor(h, `!!document.querySelector('.picker input')`, 4000))) {
    assert.equal(await clickWords(h, 'Ask or find anything', '.topbar'), 'CLICKED', 'the palette opens from the top bar');
    assert.ok(await waitFor(h, `!!document.querySelector('.picker input')`), 'the palette input shows');
  }
  await h.browser.send('Input.insertText', { text: name });
  await sleep(700);
  const picked = await h.browser.ev(`(() => {
    const rows = [...document.querySelectorAll('.picker-row')];
    const text = (r, sel) => r.querySelector(sel)?.innerText.trim() ?? '';
    // The pack's own row (a note kind may share its name: 'Goals' the kind sorts first).
    const row = rows.find((r) => text(r, '.picker-label') === ${JSON.stringify(label)} && text(r, '.picker-detail') === 'Pack')
      ?? rows.find((r) => text(r, '.picker-label') === ${JSON.stringify(label)});
    if (!row) return 'NOTFOUND';
    row.click();
    return 'CLICKED';
  })()`);
  assert.equal(picked, 'CLICKED', `${name} opens from the palette`);
  await sleep(600);
}
async function waitFor(h, js, ms = 12000) {
  const t0 = Date.now();
  for (;;) {
    try {
      if (await h.browser.ev(js)) return true;
    } catch {}
    if (Date.now() - t0 > ms) return false;
    await sleep(250);
  }
}

const MEASURE_JS = `(() => {
  const box = document.querySelector('main .nv-page, main .vpage.wide, main .td-inner, main .settings-page, main .nv-page-frame');
  const r = box?.getBoundingClientRect();
  const nav = document.querySelector('nav.places-list');
  const parent = box?.parentElement;
  const ps = parent ? getComputedStyle(parent) : null;
  return {
    boxW: r ? Math.round(r.width) : null,
    left: r ? Math.round(r.left) : null,
    room: parent ? Math.round(parent.clientWidth - parseFloat(ps.paddingLeft) - parseFloat(ps.paddingRight)) : null,
    docX: document.documentElement.scrollWidth > window.innerWidth + 1,
    navScrolls: nav ? nav.scrollHeight > nav.clientHeight + 1 : null,
  };
})()`;

// Layout round 2 (compose.css): composed, not centred. Every room's page box takes the room its frame gives it
// (no 1280 or 2400 column with empty sides) and starts at the one left edge.
async function roomsAt(h, rooms, size) {
  const [w, hh] = size;
  await h.browser.send('Emulation.setDeviceMetricsOverride', { width: w, height: hh, deviceScaleFactor: 1, mobile: false });
  await sleep(600);
  const lefts = [];
  for (const room of rooms) {
    await openRoom(h, room);
    await sleep(900);
    const m = await h.browser.ev(MEASURE_JS);
    assert.equal(m.docX, false, `${room} scrolls nowhere sideways at ${w}x${hh}`);
    assert.equal(m.navScrolls, false, `the nav never scrolls on ${room} at ${w}x${hh}`);
    assert.ok(m.boxW !== null && m.boxW >= m.room - 2, `${room} takes its room at ${w}x${hh} (stood ${m.boxW} of ${m.room})`);
    lefts.push(`${room}=${m.left}`);
  }
  const xs = lefts.map((x) => Number(x.split('=')[1]));
  assert.ok(Math.max(...xs) - Math.min(...xs) <= 2, `every room starts at one left edge at ${w}x${hh} (${lefts.join(', ')})`);
}

test('rooms take the frame at 1920x1117', { timeout: 600000 }, async () => {
  const h = await harness();
  await roomsAt(h, ['Today', 'Inbox', 'Notes', 'Money', 'Settings'], [1920, 1117]);
});

test('rooms take the frame at 3456x1408', { timeout: 600000 }, async () => {
  const h = await harness();
  await roomsAt(h, ['Today', 'Inbox', 'Projects', 'Tasks', 'Notes', 'Money', 'Goals', 'Settings'], [3456, 1408]);
});

test('the rings graph fills a wide window with its legend over it', { timeout: 600000 }, async () => {
  const h = await harness();
  await h.browser.send('Emulation.setDeviceMetricsOverride', { width: 3456, height: 1408, deviceScaleFactor: 1, mobile: false });
  await sleep(600);
  await openRoom(h, 'Graph');
  assert.ok(await waitFor(h, `window.__nvBrainGraph && window.__nvBrainGraph.snapshot().count > 0`), 'points draw');
  await sleep(1200);
  const m = await h.browser.ev(`(() => {
    const cr = document.querySelector('.bg-canvas')?.getBoundingClientRect();
    const br = document.querySelector('.nj-graph-body')?.getBoundingClientRect();
    const lr = document.querySelector('.bg-legend')?.getBoundingClientRect();
    return {
      canvas: cr ? { w: Math.round(cr.width), h: Math.round(cr.height) } : null,
      body: br ? { w: Math.round(br.width), h: Math.round(br.height) } : null,
      legend: lr ? { w: Math.round(lr.width), rows: document.querySelectorAll('.bg-row').length } : null,
      x: document.documentElement.scrollWidth > window.innerWidth + 1,
      count: window.__nvBrainGraph.snapshot().count,
    };
  })()`);
  assert.equal(m.x, false, 'the graph scrolls nowhere sideways at 3456x1408');
  assert.ok(m.canvas && m.body && Math.abs(m.canvas.w - m.body.w) <= 2 && Math.abs(m.canvas.h - m.body.h) <= 2, `the canvas fills the page (${JSON.stringify(m.canvas)} in ${JSON.stringify(m.body)})`);
  assert.ok(m.legend && Math.abs(m.legend.w - 196) <= 2 && m.legend.rows > 0, `the legend holds 196 with its rows (${JSON.stringify(m.legend)})`);
  assert.ok(m.count > 0, 'points draw');
});

test("'Centre here' and Space centre the graph on a note, still filling the window", { timeout: 600000 }, async () => {
  const h = await harness();
  await h.browser.send('Emulation.setDeviceMetricsOverride', { width: 3456, height: 1408, deviceScaleFactor: 1, mobile: false });
  await sleep(600);
  await openRoom(h, 'Graph');
  assert.ok(await waitFor(h, `window.__nvBrainGraph && window.__nvBrainGraph.snapshot().count > 0`), 'points draw');
  assert.ok(await waitFor(h, `window.__nvBrainGraph.snapshot().framed`, 60000), 'the vault settles');
  // Double-click now opens the note (8 Nov 2026, no-wait clicks): centring lives on the card's Centre here and on Space.
  const HARBOUR = 'Projects/Harbourline Cart Fix/Harbourline Cart Fix.md';
  const point = async () => {
    const s = await h.browser.ev(`window.__nvBrainGraph.snapshot()`);
    const t = s.nodes.find((x) => x.id === HARBOUR);
    assert.ok(t && t.x > 260, 'the project point sits clear of the legend');
    const box = await h.browser.ev(`(() => { const r = document.querySelector('.bg-canvas').getBoundingClientRect(); return { x: r.x, y: r.y }; })()`);
    return { x: Math.round(box.x + t.x), y: Math.round(box.y + t.y) };
  };
  const tap = async (x, y, count = 1) => {
    await h.browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: count });
    await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: count });
  };
  const filled = () =>
    h.browser.ev(`(() => {
      const cr = document.querySelector('.bg-canvas')?.getBoundingClientRect();
      const br = document.querySelector('.nj-graph-body')?.getBoundingClientRect();
      const whole = [...document.querySelectorAll('main button')].some((e) => (e.textContent || '').trim() === 'Whole vault');
      return {
        fill: cr && br ? Math.abs(cr.width - br.width) <= 2 && Math.abs(cr.height - br.height) <= 2 : false,
        whole,
        x: document.documentElement.scrollWidth > window.innerWidth + 1,
      };
    })()`);
  const first = await point();
  await tap(first.x, first.y);
  assert.ok(await waitFor(h, `((document.querySelector('.nj-graph-body .bg-card') || {}).innerText || '').includes('Centre here')`, 5000), 'the card offers Centre here');
  assert.equal(await clickWords(h, 'Centre here', '.nj-graph-body .bg-card'), 'CLICKED', 'Centre here clicks');
  assert.ok(await waitFor(h, `window.__nvBrainGraph.snapshot().centre === ${JSON.stringify(HARBOUR)}`, 10000), 'Centre here centres on the note');
  await sleep(700);
  let m = await filled();
  assert.equal(m.x, false, 'the centred graph scrolls nowhere sideways at 3456x1408');
  assert.equal(m.fill, true, 'the centred canvas still fills the page');
  assert.equal(m.whole, true, 'Whole vault steps back out');
  assert.equal(await clickWords(h, 'Whole vault'), 'CLICKED', 'back to the whole vault');
  assert.ok(await waitFor(h, `window.__nvBrainGraph.snapshot().centre === null`, 10000), 'back out');
  assert.ok(await waitFor(h, `window.__nvBrainGraph.snapshot().framed`, 60000), 'the vault settles again');
  const second = await point();
  await tap(second.x, second.y);
  assert.ok(await waitFor(h, `window.__nvBrainGraph.snapshot().selected === ${JSON.stringify(HARBOUR)}`, 5000), 'one click selects');
  await h.browser.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  assert.ok(await waitFor(h, `window.__nvBrainGraph.snapshot().centre === ${JSON.stringify(HARBOUR)}`, 10000), 'Space centres on the selected point');
  await sleep(700);
  m = await filled();
  assert.equal(m.x, false, 'the Space-centred graph scrolls nowhere sideways at 3456x1408');
  assert.equal(m.fill, true, 'the Space-centred canvas still fills the page');
  assert.equal(m.whole, true, 'Whole vault steps back out again');
});
