// node --test tests/vault-search-one.test.mjs — one search, at the top, centred (Wave 6, 4 Nov 2026,
// with a Today pictures). (1) The header search sits exactly centred over the page content column at
// every window width, never shifted by the header's left or right buttons. (2) The middle Ask box is
// gone from Today and Home; Ask, Find and Do with the scope live in the header bar's panel (the
// palette) in the same words. (3) Next for you's late mark is quiet (5 Nov 2026, plain words: late
// alone in the attention colour, never a chip), like every other late mark. Each check fails without
// its fix.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cssPxFor } from './css-px.mjs';

const require = createRequire(import.meta.url);
process.env.no_proxy = [process.env.no_proxy, '127.0.0.1,localhost'].filter(Boolean).join(',');
process.env.NO_PROXY = [process.env.NO_PROXY, '127.0.0.1,localhost'].filter(Boolean).join(',');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => cssPxFor(f, readFileSync(path.join(root, f), 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rule = (css, sel) => css.match(new RegExp(`${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 's'))?.[1] ?? assert.fail(`no ${sel}`);

const SHELL = process.env.HEADLESS_SHELL || (process.env.HOME || '') + '/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell';

// ── 1. the header search is centred over the page column ─────────────────────────────────────────

test('centred by the grid, never placed by hand: the bar fills the middle track', () => {
  const kit = read('src/renderer/src/styles/kit.css');
  assert.ok(rule(kit, '.topbar').includes('display: grid'), 'the header is a 3-column grid');
  assert.ok(kit.includes('grid-template-columns: minmax(0, 1fr) minmax(360px, 520px) minmax(0, 1fr)'), 'always-equal sides centre the 360-to-520px middle exactly');
  assert.ok(rule(kit, '.topbar').includes('column-gap: 12px'), 'the 12px breath by construction');
  const search = rule(kit, '.topbar .top-search');
  assert.ok(!search.includes('position: absolute') && !search.includes('left: 50%'), 'never absolutely placed (Round 5: four rounds of nudging an absolute bar kept missing in the real window)');
  assert.ok(search.includes('width: 100%') && search.includes('max-width: 520px'), 'the bar fills the middle track, 520px full');
  assert.ok(search.includes('margin: 0;'), 'no auto margin left to pull it off centre');
  assert.ok(!kit.includes('margin: 0 0 0 auto'), 'the narrow icon keeps the middle too');
  assert.ok(read('src/renderer/src/views/ViewHeader.tsx').includes('topbar-left'), 'the way back and the crumb ride in the grid’s left cell');
  // The page side holds the right edge of its own cell now (no z-index: the columns cannot overlap).
  const right = rule(kit, '.topbar .right');
  assert.ok(right.includes('justify-content: flex-end'), 'the page side still holds the right edge');
  assert.ok(!right.includes('margin-left: auto'), 'the grid places it, not a margin');
});

test('the sides yield measured: the crumb caps, then hides; buttons yield only on overflow', () => {
  const kit = read('src/renderer/src/styles/kit.css');
  // The crumb's cap is the room left of the centred bar: half the bar less the search's half (260),
  // the back/forward/plus block with its gaps (112) and a breath (18) — in container units now the
  // bar is a grid (a plain percent would read the grid area, not the bar).
  assert.ok(rule(kit, '.topbar .crumb').includes('max-width: calc(50cqw - 390px)'), 'long crumbs clip before the bar');
  assert.ok(!kit.includes('@container topbar (max-width: 850px)'), 'no 850px step left');
  assert.ok(kit.includes('@container topbar (max-width: 1150px) { .topbar .crumb { display: none; } }'), 'the crumb hides below 1150px of bar (the page head below names the place)');
  // Round 6: a side whose content is wider than its own cell is crowded — page buttons yield measured,
  // not by width steps (4 Nov 2026, the reviewer: nothing can overlap by construction): while their side
  // crowds its cell they ride in the ⋯ menu, one by one from the least used, the most used last. Today's
  // action opts in, with its fallback ⋯ beside it.
  assert.ok(!kit.includes('.topbar-room') && !kit.includes('.topbar-tight {'), 'no fixed width step left for buttons');
  assert.ok(kit.includes('.topbar [data-overflow].is-overflow-hidden { display: none; }'), 'hidden buttons hide');
  assert.ok(read('src/renderer/src/lib/headerOverflow.ts').includes('HEADER_SEARCH_FLOOR = 360'), 'the 360px floor under the middle track');
  const today = read('src/renderer/src/views/TodayView.tsx');
  assert.ok(today.includes('data-overflow="start-template"'), "Today's action yields");
  assert.ok(today.includes('data-overflow-fallback') && today.includes('aria-label="More for today"'), 'its ⋯ only shows while carrying it');
});

test('centred past the scrollbar gutter (the window buttons need no shift: the bar’s 50% counts the padding box)', () => {
  const kit = read('src/renderer/src/styles/kit.css');
  // Layout round 2 (compose.css 7, 20 Nov 2026): every page starts at one left edge and takes the room, so the
  // scrollers keep their bar's lane on the right only (both edges stood some pages 10 px right of others). The
  // bar centres over the scroller's whole box, its lane included, so a scrollbar never pulls it off; the live walk
  // below measures that box (updated 23 Nov 2026).
  assert.ok(rule(read('src/renderer/src/styles/today.css'), '.td-view').includes('scrollbar-gutter: stable'), 'Today keeps its gutter');
  assert.ok(rule(kit, '.vscroll').includes('scrollbar-gutter: stable'), 'every vscroll page keeps its gutter');
  const compose = read('src/renderer/src/styles/compose.css');
  assert.ok(/\.vscroll,\s*\.nv-page-scroll,\s*\.td-view\s*\{\s*scrollbar-gutter: stable;/.test(compose), 'the scrollers keep the lane on one side, after kit.css');
  const main = read('src/renderer/src/main.tsx');
  assert.ok(main.indexOf("import './styles/compose.css';") > main.indexOf("import './styles/kit.css';"), 'compose.css settles it, loaded after kit.css');
});

// ── 2. one search, at the top ────────────────────────────────────────────────────────────────────

test('the middle box is gone from Today and Home; the floating bar is gone too', () => {
  for (const f of ['src/renderer/src/views/TodayView.tsx', 'src/renderer/src/views/HomeView.tsx']) {
    const src = read(f);
    assert.ok(!src.includes('AskBox'), `${f} draws no Ask box`);
    assert.ok(!src.includes('Ask or find anything in your vault'), `${f} keeps none of its words`);
    assert.ok(!src.includes('NoAskBar') && !src.includes('data-no-askbar'), `${f} needs no bar opt-out: one search, at the top`);
  }
  // Its switches went with it (a switch with no box would do nothing); saved ones wash out on load.
  const prefs = read('src/shared/prefs.ts');
  assert.ok(!prefs.includes("'home:ask'") && !prefs.includes("'today:ask'"), 'no ask-box switch in Today or Home');
  const hub = read('src/shared/hub.ts');
  assert.ok(!hub.includes('home:ask') && !hub.includes('today:ask'), 'no stale mapping for them');
});

test('Ask, Find and Do with the scope live in the header bar’s panel, in the same words', () => {
  const modals = read('src/renderer/src/components/Modals.tsx');
  const palette = modals.split('export function CommandPalette')[1].split('export function Welcome')[0];
  assert.ok(palette.includes('aria-label="What to do with the words"'), 'the modes group, as the box named it');
  for (const [tab, title] of [['Ask', 'Ask the assistant'], ['Find', 'Find it in your notes'], ['Do', 'File it as a task']]) {
    assert.ok(palette.includes(`'${tab.toLowerCase()}'`) && palette.includes(title), `${tab}, with the box’s title`);
  }
  assert.ok(palette.includes("'All notes'"), 'the scope, starting at All notes');
  assert.ok(palette.includes('recentPaths.slice(0, 6)'), 'then the pages opened lately, six like the box');
  assert.ok(palette.includes('Which notes the assistant reads') && palette.includes('The assistant reads these when Asking'), 'the scope says what it does, as the box did');
  // Each mode does what the box did, down the same one path.
  assert.ok(palette.includes('Ask the assistant about'), 'Ask names its row');
  assert.ok(palette.includes('sendChat(q, source') && palette.includes('draftInChat(q, source'), 'Ask puts the words to the helper, drafted when it cannot send');
  assert.ok(palette.includes('requestSearch(words)'), 'Find searches the vault');
  assert.ok(palette.includes('File “') && palette.includes('as a task'), 'Do names its row');
  assert.ok(palette.includes('A.fileTaskText('), 'Do files down the one filing path');
  assert.ok(palette.includes('if (filed) onClose()'), 'Do stays open on a failure, with the words still there');
});

// ── 3. the quiet late mark ───────────────────────────────────────────────────────────────────────

test('Next for you’s late mark is quiet: late alone in the attention colour, never a chip', () => {
  // 5 Nov 2026, status in plain words: the quiet chip went with its coral dot — a Next row's when reads
  // plain words through the one when cell, late alone in the attention colour, today and after quiet.
  const today = read('src/renderer/src/views/TodayView.tsx');
  assert.ok(today.includes('<WhenInner words={pill.words} tone={whenTone(x.offset)} />'), 'Next rows read the one when cell with the one tone');
  const plan = read('src/renderer/src/components/plan/plan.ts');
  assert.ok(plan.includes("return offset < 0 ? 'coral' : 'quiet'"), 'late alone reads coral, today and after quiet');
  const cells = read('src/renderer/src/components/plan/TaskCells.tsx');
  assert.ok(cells.includes('tkrow-moment is-${tone}'), 'the one when cell carries the tone');
  assert.ok(!cells.includes('plan-pill'), 'no chip renders the lateness any more');
  const css = read('src/renderer/src/styles/plan.css');
  assert.ok(/\.tkrow-moment\.is-coral \{[^}]*var\(--accent-strong, var\(--accent-text\)\)/.test(css), 'late reads the attention colour');
  assert.ok(/\.tkrow-moment\.is-quiet \{[^}]*var\(--text-muted\)/.test(css), 'the rest reads quiet neutral');
});

// ── live: the bar over the column, to the pixel ──────────────────────────────────────────────────

// The window's stylesheets in the order it loads them (main.tsx), so the cascade is the window's.
function stylesheets() {
  const order = [...read('src/renderer/src/main.tsx').matchAll(/import '\.\/(styles\.css|styles\/[^']+\.css)';/g)].map((m) => m[1]);
  assert.ok(order.length > 10 && order[0] === 'styles.css', `${order.length} stylesheets in the window's order`);
  return order.map((f) => `/* ${f} */\n${read(`src/renderer/src/${f}`)}`).join('\n');
}

const icon = (s = 16) => `<svg width="${s}" height="${s}" viewBox="0 0 16 16" aria-hidden="true"><rect width="16" height="16" fill="currentColor"/></svg>`;

// The header as ViewHeader.tsx draws it (back, forward, a new note, the crumb, the centred search,
// the page's buttons, the avatar — no Ask chip since 5 Nov 2026, one search door), over a page column
// filled past the fold, beside the rail.
function scene({ topbarClass, right, column, platform }) {
  const filler = Array.from({ length: 60 }, (_, i) => `<div class="trow"><span class="t clip">Made-up row ${i}</span></div>`).join('');
  return `<!doctype html>
<html lang="en-AU" data-theme="light">
<head><meta charset="utf-8"><style>__CSS__</style></head>
<body>
<div class="app" data-platform="${platform}"><div class="ribbon"></div><aside class="sidebar left side" style="width:292px" aria-label="Places and notes"></aside><main class="main">
<div class="${topbarClass}">
  <div class="topbar-left">
  <div class="view-nav">
    <button class="navbtn" aria-label="Back" disabled>←</button>
    <button class="navbtn" aria-label="Forward" disabled>→</button>
    <button class="navbtn" aria-label="New">+</button>
  </div>
  <div class="crumb" title=""></div>
  </div>
  <button class="top-search" title="Commands, pages and search (Ctrl+K or Ctrl+O)" aria-label="Commands, pages and search">${icon()}<span class="clip">Ask or find anything</span><kbd>Ctrl+K</kbd></button>
  <div class="right">${right}</div>
</div>
${column(filler)}
</main></div>
</body>
</html>
`;
}

// No avatar since 20 Nov 2026: Settings and the account live in one account row at the side bar's foot.
const ava = '';

test('always-equal sides centre the bar exactly over the column, at 1219, 1440, 1600 and a wide window', async () => {
  assert.ok(existsSync(SHELL), `no headless Chromium (HEADLESS_SHELL): ${SHELL}`);
  const WebSocket = require('ws');
  const css = stylesheets();
  const dir = mkdtempSync(path.join(tmpdir(), 'nv-search-one-'));
  // The real header layout, built from the repo's own module: each scene lays its bar out as the app does.
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  await build({ input: path.join(root, 'src/renderer/src/lib/headerOverflow.ts'), platform: 'browser', output: { file: path.join(dir, 'hdr.mjs'), format: 'iife', name: 'Hdr' }, logLevel: 'silent' });
  const lib = readFileSync(path.join(dir, 'hdr.mjs'), 'utf8');
  const todayCol = (filler) => `<div class="td-view th-hub"><div class="td-inner"><header class="td-head nv-today-head"><h1 class="nv-page-title">Good morning, Test</h1></header><section class="td-section td-next"><header class="td-section-head"><h2>Next for you</h2></header><div class="td-row plan-row"><span class="td-row-main"><span class="td-row-what"><span class="td-text">Book a GP visit</span></span></span><span class="plan-pill tone-bad"><span class="dot" aria-hidden="true"></span>14 days late</span></div></section><div class="card">${filler}</div></div></div>`;
  const homeCol = (filler) => `<div class="vscroll"><div class="vpage wide"><h1 class="w2a-title">Home</h1><div class="card">${filler}</div></div></div>`;
  const startBtn = `<button type="button" class="btn quiet" data-overflow="start-template" data-overflow-order="1">Start from a template</button><button type="button" class="navbtn topbar-tight-only" data-overflow-fallback="" aria-label="More for today">${icon()}</button>`;
  const scenes = {
    today: scene({ topbarClass: 'topbar', platform: 'linux', right: `${startBtn}${ava}`, column: todayCol }),
    home: scene({ topbarClass: 'topbar', platform: 'linux', right: `${ava}`, column: homeCol }),
    band: scene({ topbarClass: 'topbar drag is-band controls-gap', platform: 'win32', right: `${startBtn}${ava}`, column: todayCol }),
  };
  const files = new Map();
  for (const [name, html] of Object.entries(scenes)) {
    const file = path.join(dir, `${name}.html`);
    writeFileSync(file, html.replace('__CSS__', css));
    files.set(name, file);
  }
  const port = await new Promise((resolve) => {
    const net = require('node:net');
    const s = net.createServer(() => {});
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
  const child = spawn(SHELL, ['--headless', '--no-sandbox', '--disable-gpu', '--no-proxy-server', `--remote-debugging-port=${port}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
  try {
    let target;
    for (let i = 0; i < 100 && !target; i++) {
      await sleep(150);
      try {
        target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((x) => x.type === 'page');
      } catch {}
    }
    assert.ok(target, 'the browser opened');
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((r) => (ws.onopen = r));
    let id = 1;
    const pending = new Map();
    ws.onmessage = (m) => {
      const d = JSON.parse(typeof m.data === 'string' ? m.data : m.data.toString());
      if (d.id && pending.has(d.id)) {
        pending.get(d.id)(d.result);
        pending.delete(d.id);
      }
    };
    const send = (method, params = {}) => new Promise((resolve) => {
      const i = id++;
      pending.set(i, resolve);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
    const ev = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.value;
    await send('Page.enable');
    await send('Runtime.enable');
    for (const [W, H] of [[1219, 709], [1440, 900], [1600, 1000], [2000, 837]]) {
      await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
      for (const name of ['today', 'home']) {
        await send('Page.navigate', { url: pathToFileURL(files.get(name)).href });
        let ready = false;
        for (let i = 0; i < 60 && !ready; i++) {
          await sleep(150);
          try {
            ready = await ev(`!!document.querySelector('.top-search')`);
          } catch {}
        }
        assert.ok(ready, `the header drew at ${W}px (${name})`);
        await ev(lib);
        await ev(`Hdr.layoutHeaderOverflow(document.querySelector('.topbar'), 'tab-1')`);
        const m = await ev(`(() => {
          const r = (el) => { const b = el.getBoundingClientRect(); return { x: b.x, w: b.width }; };
          const bar = document.querySelector('.topbar'), search = document.querySelector('.top-search');
          // The column is the scroller's box, its bar's lane included (compose.css 7; see the gutter check above).
          const col = document.querySelector('.td-view, .vscroll');
          const left = document.querySelector('.topbar-left'), right = document.querySelector('.topbar .right');
          const B = r(bar), S = r(search), C = r(col), L = r(left), R = r(right);
          return { barH: bar.getBoundingClientRect().height, searchW: S.w, searchC: S.x + S.w / 2, colC: C.x + C.w / 2, leftW: L.w, rightW: R.w, gapL: S.x - (L.x + L.w), gapR: R.x - (S.x + S.w), hidden: Hdr.headerOverflowHidden('tab-1'), roomy: bar.classList.contains('is-left-roomy') || bar.classList.contains('is-right-roomy') };
        })()`);
        assert.equal(Math.round(m.barH), 56, `${name} at ${W}px: the header keeps its one height`);
        assert.ok(Math.round(m.searchW) >= 360 && Math.round(m.searchW) <= 520, `${name} at ${W}px: the grid sizes the bar 360 to 520px (${Math.round(m.searchW)}px)`);
        // Exactly centred: the sides are always equal, whatever they carry (a fallback still moves by half
        // the side difference, with everything yielded first).
        const off = Math.abs(m.searchC - m.colC);
        assert.ok(Math.abs(off - Math.abs(m.leftW - m.rightW) / 2) <= 1.5, `${name} at ${W}px: the move is half the side difference (${off.toFixed(1)}px off, sides ${m.leftW.toFixed(0)}/${m.rightW.toFixed(0)})`);
        if (!m.roomy) assert.ok(off <= 2, `${name} at ${W}px: centred within 2px (${off.toFixed(1)}px off)`);
        else assert.deepEqual(m.hidden, name === 'home' ? [] : ['start-template'], `${name} at ${W}px: a fallback means everything yielded first`);
        if (name === 'home') assert.deepEqual(m.hidden, [], `home at ${W}px: bare, nothing to yield`);
        else assert.deepEqual(m.hidden, W === 1219 ? ['start-template'] : [], `${name} at ${W}px: Today's action rides in the ⋯ while its side crowds its cell (back from 1440 since the Ask chip left)`);
        assert.ok(m.gapL >= 12 && m.gapR >= 12, `${name} at ${W}px: the grid keeps every 12px (left ${m.gapL.toFixed(1)}px, right ${m.gapR.toFixed(1)}px)`);
      }
    }
    // Tabs off on Windows: the window-buttons gap lives inside the right cell, and the bar keeps its
    // floor and its 12px from the avatar (Round 5: its right end ran under Ask in the real window; the chip
    // itself left on 5 Nov 2026).
    // At 1600 the sides still fit their equal cells, so the bar is exactly centred with Today's action back
    // beside the gap (the 1219 band fallback is proven in vault-header-overflow).
    await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: pathToFileURL(files.get('band')).href });
    let ready = false;
    for (let i = 0; i < 60 && !ready; i++) {
      await sleep(150);
      try {
        ready = await ev(`!!document.querySelector('.top-search')`);
      } catch {}
    }
    assert.ok(ready, 'the band header drew');
    await ev(lib);
    await ev(`Hdr.layoutHeaderOverflow(document.querySelector('.topbar'), 'tab-1')`);
    const b = await ev(`(() => {
      const r = (el) => { const b = el.getBoundingClientRect(); return { x: b.x, w: b.width }; };
      const bar = document.querySelector('.topbar');
      const S = r(document.querySelector('.top-search')), C = r(document.querySelector('.td-view'));
      const L = r(document.querySelector('.topbar-left')), R = r(document.querySelector('.topbar .right'));
      const kids = [...document.querySelector('.topbar .right').children].map((el) => {
        const q = r(el);
        const vis = q.w > 0 && getComputedStyle(el).display !== 'none';
        return { vis, left: q.x, right: q.x + q.w };
      });
      return { searchW: S.w, searchC: S.x + S.w / 2, colC: C.x + C.w / 2, leftW: L.w, rightW: R.w, kids, hidden: Hdr.headerOverflowHidden('tab-1'), roomy: bar.classList.contains('is-left-roomy') || bar.classList.contains('is-right-roomy') };
    })()`);
    assert.ok(Math.round(b.searchW) >= 360 && Math.round(b.searchW) <= 520, `the band keeps 360–520px at 1600 (${Math.round(b.searchW)}px)`);
    assert.ok(Math.abs(Math.abs(b.searchC - b.colC) - Math.abs(b.leftW - b.rightW) / 2) <= 2, `the band moves by half the side difference (${Math.abs(b.searchC - b.colC).toFixed(1)}px off, sides ${b.leftW.toFixed(0)}/${b.rightW.toFixed(0)})`);
    assert.equal(b.roomy, false, 'the band needs no fallback at 1600');
    assert.ok(Math.abs(b.searchC - b.colC) <= 2, `the band is exactly centred at 1600 (${Math.abs(b.searchC - b.colC).toFixed(1)}px off)`);
    assert.deepEqual(b.hidden, [], 'the band: Today’s action fits beside the live gap (the Ask chip’s room)');
    for (const k of b.kids) {
      if (!k.vis) continue;
      assert.ok(!(k.left < b.searchC + b.searchW / 2 && k.right > b.searchC - b.searchW / 2), 'the band: nothing touches the bar');
      assert.ok(k.left - (b.searchC + b.searchW / 2) >= 11.5, 'the band: the avatar keeps 12px');
    }
    ws.close();
  } finally {
    child.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});
