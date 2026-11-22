// node --test tests/vault-header-overflow.test.mjs — the header contract (Round 6, 4 Nov 2026, the reviewer:
// with max-content sides the bar sat 97-233px left of centre, and off-centre was the complaint — centring
// wins over keeping every page button visible, they have ⋯). The bar is a 3-column grid with two always-equal
// sides, so the middle is exactly centred over the whole header; nothing can overlap by construction. A side
// whose content is wider than its own cell is crowded: on the right, page buttons yield into the ⋯ menu (the
// same menu, same words, same actions), one by one from the least used, the most used last (Share on notes
// and projects, New project on Projects); on the left the crumb clips without dots by itself (full text in
// its title; t207 pass 2) and ← → + never hide. Only a side that still cannot fit falls back to its
// max-content column (the least move); a window too narrow for the bare sides squeezes the bar to its 40px
// button. Each check fails without its fix.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
process.env.no_proxy = [process.env.no_proxy, '127.0.0.1,localhost'].filter(Boolean).join(',');
process.env.NO_PROXY = [process.env.NO_PROXY, '127.0.0.1,localhost'].filter(Boolean).join(',');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SHELL = process.env.HEADLESS_SHELL || (process.env.HOME || '') + '/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell';

// Every page with header buttons, and the overflow keys its buttons carry (least used first).
const PAGES = {
  'src/renderer/src/views/ProjectsHome.tsx': ['weekly-review', 'new-project'],
  'src/renderer/src/views/NoteView.tsx': ['private', 'share', 'read'], // 5 Nov 2026, the clean header: Share, Read and the Private mark only
  // 5 Nov 2026, the vault folio: the header carries people, Share and Publish (Fields on Facts); each
  // section carries its own primary in its head, so no add-* key folds any more.
  'src/renderer/src/views/ProjectPage.tsx': ['publish', 'fields', 'people', 'share'],
  'src/renderer/src/views/TasksView.tsx': ['new-task'],
  'src/renderer/src/views/InboxPage.tsx': ['inbox-note', 'capture'],
  'src/renderer/src/views/TimelineView.tsx': ['rows', 'board', 'timeline'],
  'src/renderer/src/views/SharedSpacePage.tsx': ['all-spaces'],
  'src/renderer/src/views/BinView.tsx': ['empty-all'],
  'src/renderer/src/views/WeeklyTidyView.tsx': ['apply-all'],
  'src/renderer/src/views/LockedView.tsx': ['unlocked', 'lock-now', 'new-secret'],
  'src/renderer/src/views/MediaView.tsx': ['open-default'],
  'src/renderer/src/views/pdf/PdfView.tsx': ['open-default'],
  'src/renderer/src/views/TodayView.tsx': ['start-template'],
};
// Pages without their own ⋯ menu: the fallback beside their buttons carries the hidden ones.
const FALLBACKS = ['InboxPage.tsx', 'TimelineView.tsx', 'SharedSpacePage.tsx', 'BinView.tsx', 'WeeklyTidyView.tsx', 'TodayView.tsx'];

test('the mechanism: always-equal sides centre the bar; a crowded side yields, then falls back', () => {
  const lib = read('src/renderer/src/lib/headerOverflow.ts');
  assert.ok(lib.includes('HEADER_OVERFLOW_GAP = 12'), 'the 12px breath the grid keeps between the bar and either side');
  assert.ok(lib.includes('HEADER_SEARCH_FLOOR = 360'), 'the 360px floor under the middle track');
  for (const fn of ['layoutHeaderOverflow', 'headerOverflowHidden', 'headerOverflowCrowded', 'overflowMenuItems', 'clearHeaderOverflow']) assert.ok(lib.includes(`export function ${fn}`), `the shared ${fn}`);
  assert.ok(lib.includes("sort((a, b) => (Number(a.dataset.overflowOrder"), 'lowest order yields first');
  assert.ok(!lib.includes('search.style.width') && !lib.includes('search.style.left'), 'the module never moves or sizes the bar (it only hides buttons and marks the fallback columns)');
  assert.ok(lib.includes("querySelector('.topbar-left')") && lib.includes('content is wider than its own cell'), 'crowded means a side’s content is wider than its own cell, each side measured against its cell');
  assert.ok(lib.includes('is-right-roomy') && lib.includes('is-left-roomy'), 'a side that still cannot fit falls back to its max-content column (the least move, never an overlap)');
  assert.ok(lib.includes('topbar.scrollWidth > topbar.clientWidth'), 'a window too narrow for even the bare sides squeezes to the 40px button');
  assert.ok(lib.includes('hiddenByTab'), 'split panes lay out independently, by tab');
  const head = read('src/renderer/src/views/ViewHeader.tsx');
  assert.ok(head.includes('layoutHeaderOverflow(barRef.current, tab.id)'), 'laid out after every render');
  assert.ok(head.includes("window.addEventListener('resize'") && head.includes('new ResizeObserver(relayout)'), 'and on every resize');
  assert.ok(head.includes('clearHeaderOverflow(tab.id)'), 'a closed tab is forgotten');
  assert.ok(head.includes('topbar-left'), 'the way back and the crumb ride in the grid’s left cell');
  assert.ok(head.includes('title={tab.path}'), 'the crumb keeps its full text in its title while it clips without dots');
  const kit = read('src/renderer/src/styles/kit.css');
  assert.ok(kit.includes('grid-template-columns: minmax(0, 1fr) minmax(360px, 520px) minmax(0, 1fr)'), 'the 3-column grid: always-equal sides centre the 360-to-520px middle exactly');
  assert.ok(kit.includes('.topbar.is-left-roomy { grid-template-columns: minmax(max-content, 1fr) minmax(360px, 520px) minmax(0, 1fr); }'), 'the left fallback column');
  assert.ok(kit.includes('.topbar.is-right-roomy { grid-template-columns: minmax(0, 1fr) minmax(360px, 520px) minmax(max-content, 1fr); }'), 'the right fallback column');
  assert.ok(kit.includes('.topbar.is-left-roomy.is-right-roomy { grid-template-columns: minmax(max-content, 1fr) minmax(360px, 520px) minmax(max-content, 1fr); }'), 'both set reads both max-content columns (one rule would silently drop the other side)');
  assert.ok(kit.includes('column-gap: 12px'), 'the 12px breath by construction (nothing can come closer)');
  assert.ok(!/\.topbar \.top-search \{[^}]*position:\s*absolute/s.test(kit), 'no absolute positioning anywhere on the bar');
  assert.ok(kit.includes('.topbar > .right > * { flex: none; }'), 'the right side’s children never shrink: they overflow honestly instead of crushing, so the crowded check sees them');
  assert.ok(kit.includes(".app[data-platform='win32'] .topbar.controls-gap > .right"), 'the window-buttons gap lives inside the right cell, never on the bar');
  assert.ok(kit.includes('.topbar.is-squeezed { grid-template-columns: minmax(0, 1fr) 40px minmax(0, 1fr); }'), 'too narrow for the bare sides: the middle track squeezes to the 40px button');
  assert.ok(kit.includes('.topbar.is-squeezed > .right { justify-content: flex-start; box-sizing: border-box; }'), 'squeezed, the cell stays on its track and the ⋯ stays whole');
  assert.ok(kit.includes('.topbar [data-overflow].is-overflow-hidden { display: none; }'), 'hidden buttons hide');
  assert.ok(kit.includes('.topbar .navbtn.topbar-tight-only.is-shown { display: inline-grid; }'), 'the fallback ⋯ only shows while carrying');
  assert.ok(!kit.includes('.topbar-room') && !kit.includes('.topbar-tight {'), 'no fixed width step left for buttons (the crumb keeps its own)');
});

test('every page button that can meet the bar yields, in least-used order, into its ⋯ menu', () => {
  for (const [file, keys] of Object.entries(PAGES)) {
    const src = read(file);
    for (const key of keys) {
      assert.ok(src.includes(`data-overflow="${key}"`) || src.includes(`overflow="${key}"`), `${file} marks ${key}`);
      assert.ok(src.includes(`'${key}':`), `${file} defines ${key}'s menu row (or null, with its reason)`);
    }
    // Each marked button names its yield order (ShareButton's arrive as props).
    const marked = (src.match(/data-overflow="/g) || []).length;
    const ordered = (src.match(/data-overflow-order={/g) || []).length;
    const viaShare = (src.match(/(?<![\w-])overflow="/g) || []).length;
    const viaShareOrdered = (src.match(/overflowOrder={/g) || []).length;
    assert.equal(marked + viaShare > 0, true, `${file} marks buttons`);
    assert.equal(ordered, marked, `${file}: every marked button names its order`);
    assert.equal(viaShareOrdered, viaShare, `${file}: every ShareButton order arrives`);
    assert.ok(src.includes('overflowMenuItems(headerOverflowHidden('), `${file}: the ⋯ menu carries exactly the hidden ones`);
    assert.ok(src.includes("from '../lib/headerOverflow'") || src.includes("from '../../lib/headerOverflow'"), `${file} reads the one mechanism`);
    const name = file.slice(file.lastIndexOf('/') + 1);
    if (FALLBACKS.includes(name)) assert.ok(src.includes('data-overflow-fallback'), `${file}: the fallback ⋯ beside its buttons`);
    else assert.ok(src.includes('menu={') || src.includes('onClick={more}'), `${file}: the page's own ⋯ menu`);
  }
  // ShareButton passes overflow through (its top-bar use); its pack uses stay bare.
  assert.ok(read('src/renderer/src/components/ShareButton.tsx').includes('data-overflow={overflow}'), 'ShareButton passes it through');
  // The most used yields last (Round 3): Share on notes and projects, New project on Projects, New secret on Locked.
  assert.ok(read('src/renderer/src/views/NoteView.tsx').includes('overflow="share" overflowOrder={11}'), 'a note: Share yields last');
  assert.ok(read('src/renderer/src/views/ProjectPage.tsx').includes('data-overflow="share" data-overflow-order={3}'), 'a project: Share yields last');
  assert.ok(read('src/renderer/src/views/ProjectsHome.tsx').includes('data-overflow="new-project" data-overflow-order={2}'), 'Projects: New project yields last');
  assert.ok(read('src/renderer/src/views/LockedView.tsx').includes('data-overflow="new-secret" data-overflow-order={3}'), 'Locked: New secret yields last');
  // Nothing a person uses to find the ⋯ moved: the fallback keeps its words, and the menus keep theirs.
  for (const [file, label] of [['src/renderer/src/views/TodayView.tsx', 'More for today'], ['src/renderer/src/views/InboxPage.tsx', 'More for the inbox']]) {
    assert.ok(read(file).includes(`aria-label="${label}"`), `${label} keeps its name`);
  }
});

// ── live: every page's bar at 1219, 1440, 1600 and their width
// ─ ─────────────────────────────────────────────────────────────────────────────────────────────────

// The window's stylesheets in the order it loads them (main.tsx), so the cascade is the window's.
function stylesheets() {
  const order = [...read('src/renderer/src/main.tsx').matchAll(/import '\.\/(styles\.css|styles\/[^']+\.css)';/g)].map((m) => m[1]);
  assert.ok(order.length > 10 && order[0] === 'styles.css', `${order.length} stylesheets in the window's order`);
  return order.map((f) => `/* ${f} */\n${read(`src/renderer/src/${f}`)}`).join('\n');
}

const icon = (s = 16) => `<svg width="${s}" height="${s}" viewBox="0 0 16 16" aria-hidden="true"><rect width="16" height="16" fill="currentColor"/></svg>`;
// (No Ask chip since 5 Nov 2026, one search door: it left every header for the centred bar's panel.)
// No avatar either since 20 Nov 2026: Settings and the account moved to one account row at the side bar's foot, so
// the header's right side holds only the page's own buttons and its ⋯ (updated 23 Nov 2026).
const ava = '';
const more = `<button class="navbtn" title="More" aria-label="More">${icon()}</button>`;
// A page's header as its view draws it (button classes, words and overflow keys from the views above).
const HEADS = {
  'projects': `<button class="btn" data-overflow="weekly-review" data-overflow-order="1">Weekly review</button><button class="btn pri" data-overflow="new-project" data-overflow-order="2">${icon(14)} New project</button>${more}${ava}`,
  'note': `<button class="btn" data-overflow="share" data-overflow-order="11">Share</button><button class="icon-button" data-overflow="read" data-overflow-order="10">${icon()}</button>${more}${ava}`,
  'note-private': `<span class="view-private" data-overflow="private" data-overflow-order="5">${icon(13)}<span>Private</span></span><button class="icon-button" data-overflow="read" data-overflow-order="10">${icon()}</button>${more}${ava}`,
  'project-overview': `<button class="avatars w2a-ava" data-overflow="people" data-overflow-order="2" aria-label="Everyone on this project"><i class="miniava">AB</i><i class="miniava">CD</i></button><button class="btn" data-overflow="share" data-overflow-order="3">Share</button><button class="btn" data-overflow="publish" data-overflow-order="1">Publish</button>${more}${ava}`,
  'project-facts': `<button class="btn" data-overflow="fields" data-overflow-order="2">Fields</button><button class="btn" data-overflow="share" data-overflow-order="3">Share</button><button class="btn" data-overflow="publish" data-overflow-order="1">Publish</button>${more}${ava}`,
  'project-tasks': `<button class="btn pri" data-overflow="add-task" data-overflow-order="1">${icon(14)} Add task</button>${more}${ava}`,
  'tasks': `<button class="btn pri" data-overflow="new-task" data-overflow-order="1">+ New task</button>${more}${ava}`,
  'inbox': `<button type="button" class="btn" data-overflow="inbox-note" data-overflow-order="1">Inbox note</button><button type="button" class="btn pri" data-overflow="capture" data-overflow-order="2">+ Capture</button><button type="button" class="navbtn topbar-tight-only" data-overflow-fallback="" aria-label="More for the inbox">${icon()}</button>${ava}`,
  'timeline': `<button class="btn quiet" data-overflow="rows" data-overflow-order="1">Rows</button><button class="btn quiet" data-overflow="board" data-overflow-order="2">Board</button><button class="btn" data-overflow="timeline" data-overflow-order="3">Timeline</button><button type="button" class="navbtn topbar-tight-only" data-overflow-fallback="" aria-label="More for the timeline">${icon()}</button>${ava}`,
  'shared-space': `<button type="button" class="btn" data-overflow="all-spaces" data-overflow-order="1">All spaces</button><button type="button" class="navbtn topbar-tight-only" data-overflow-fallback="" aria-label="More for this shared space">${icon()}</button>${ava}`,
  'bin': `<button type="button" class="btn" data-overflow="empty-all" data-overflow-order="1">Remove all</button><button type="button" class="navbtn topbar-tight-only" data-overflow-fallback="" aria-label="More for the Bin">${icon()}</button>${ava}`,
  'tidy': `<button type="button" class="btn" data-overflow="apply-all" data-overflow-order="1">Apply all</button><button type="button" class="navbtn topbar-tight-only" data-overflow-fallback="" aria-label="More for the weekly tidy">${icon()}</button>${ava}`,
  'locked': `<span class="tag amber" data-overflow="unlocked" data-overflow-order="1">Unlocked · 10 minutes</span><button class="btn" data-overflow="lock-now" data-overflow-order="2">Lock now</button><button class="btn pri" data-overflow="new-secret" data-overflow-order="3">${icon(14)} New secret</button><button class="iconbtn">${icon()}</button>${ava}`,
  'media': `<button class="icon-button" data-overflow="open-default" data-overflow-order="1">${icon()}</button>${more}${ava}`,
  'today': `<button type="button" class="btn quiet" data-overflow="start-template" data-overflow-order="1">Start from a template</button><button type="button" class="navbtn topbar-tight-only" data-overflow-fallback="" aria-label="More for today">${icon()}</button>${ava}`,
  'bare': `${ava}`,
  // A bare bar under a crumb far longer than its cell (Round 6, clause 2): the crumb clips without dots
  // by itself, ← → + never hide, the bar stays exactly centred.
  'long-crumb': `${ava}`,
};
const CRUMB = 'Projects / Harbour / <b>Launch plan</b>';
const LONG_CRUMB = 'Areas / Work / Clients / Harbour Trust / Delivery / 2026 / November / Week 45 / <b>Launch plan and open questions</b>';

function scene(css) {
  const bars = Object.entries(HEADS).map(([page, right]) => `<div class="topbar" data-page="${page}">
  <div class="topbar-left"><div class="view-nav"><button class="navbtn" aria-label="Back" disabled>←</button><button class="navbtn" aria-label="Forward" disabled>→</button><button class="navbtn" aria-label="New">+</button></div>
  <div class="crumb" title="Projects/Harbour/Launch plan.md">${page === 'long-crumb' ? LONG_CRUMB : CRUMB}</div></div>
  <button class="top-search" aria-label="Commands, pages and search">${icon()}<span class="clip">Ask or find anything</span><kbd>Ctrl+K</kbd></button>
  <div class="right">${right}</div>
</div>`).join('\n');
  const filler = Array.from({ length: 40 }, (_, i) => `<div class="trow"><span class="t clip">Made-up row ${i}</span></div>`).join('');
  return `<!doctype html>
<html lang="en-AU" data-theme="light">
<head><meta charset="utf-8"><style>${css}</style></head>
<body>
<div class="app" data-platform="linux"><div class="ribbon"></div><aside class="sidebar left side" style="width:292px" aria-label="Places and notes"></aside><main class="main">
${bars}
<div class="vscroll"><div class="vpage wide"><h1 class="w2a-title">Page</h1><div class="card">${filler}</div></div></div>
</main></div>
</body>
</html>
`;
}

test('always-equal sides centre the bar; a crowded side yields, then falls back: measured rectangles at 1219, 1440, 1600 and 3456 wide', async () => {
  assert.ok(existsSync(SHELL), `no headless Chromium (HEADLESS_SHELL): ${SHELL}`);
  const WebSocket = require('ws');
  const css = stylesheets();
  // The real layout, built from the repo's own module (never a copy of it).
  const dir = mkdtempSync(path.join(tmpdir(), 'nv-header-overflow-'));
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  await build({ input: path.join(root, 'src/renderer/src/lib/headerOverflow.ts'), platform: 'browser', output: { file: path.join(dir, 'hdr.mjs'), format: 'iife', name: 'Hdr' }, logLevel: 'silent' });
  const lib = readFileSync(path.join(dir, 'hdr.mjs'), 'utf8');
  assert.ok(lib.includes('layoutHeaderOverflow'), 'the built layout');
  const file = path.join(dir, 'heads.html');
  writeFileSync(file, scene(css));
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
    await send('Page.navigate', { url: pathToFileURL(file).href });
    let ready = false;
    for (let i = 0; i < 60 && !ready; i++) {
      await sleep(150);
      try {
        ready = await ev(`document.querySelectorAll('.topbar').length === ${Object.keys(HEADS).length}`);
      } catch {}
    }
    assert.ok(ready, 'every page header drew');
    await ev(lib);
    for (const [W, H] of [[1219, 709], [1440, 900], [1600, 1000], [2000, 837]]) {
      await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
      await sleep(300);
      // Lay every bar out as the app does after a render, then read every rectangle.
      const measured = await ev(`(() => {
        const out = [];
        // The page column is the scroller's box: since layout round 2 every frame takes the room from one left edge,
        // and the scroller keeps its bar's lane on the right only (compose.css 7), so the content's own box sits
        // half that lane left of the room's centre; the bar centres over the room, lane included (23 Nov 2026).
        const col = document.querySelector('.vscroll').getBoundingClientRect();
        const colC = col.x + col.width / 2;
        for (const bar of document.querySelectorAll('.topbar')) {
          const page = bar.dataset.page;
          const hidden = Hdr.layoutHeaderOverflow(bar, 'tab-' + page);
          const s = bar.querySelector('.top-search').getBoundingClientRect();
          const leftW = bar.querySelector('.topbar-left').getBoundingClientRect().width;
          const rightW = bar.querySelector(':scope .right').getBoundingClientRect().width;
          const crumb = bar.querySelector('.crumb');
          const cb = crumb.getBoundingClientRect();
          const nav = bar.querySelector('.view-nav').getBoundingClientRect();
          const roomy = bar.classList.contains('is-left-roomy') || bar.classList.contains('is-right-roomy');
          const kids = [...bar.querySelector(':scope .right').children].map((el) => {
            const b = el.getBoundingClientRect();
            const cs = getComputedStyle(el);
            const vis = b.width > 0 && cs.display !== 'none' && cs.visibility !== 'hidden';
            return { key: el.dataset.overflow ?? null, fallback: el.hasAttribute('data-overflow-fallback') && el.classList.contains('is-shown'), order: el.dataset.overflowOrder ?? null, vis, left: b.x, right: b.x + b.width };
          });
          const items = bar.querySelectorAll(':scope .right [data-overflow]').length;
          // Yield exactly while crowded: strip the fallbacks, show everything again (the ⋯ stays as laid
          // out) and ask the module whether the side crowds its cell.
          bar.classList.remove('is-squeezed', 'is-left-roomy', 'is-right-roomy');
          for (const el of bar.querySelectorAll('.is-overflow-hidden')) el.classList.remove('is-overflow-hidden');
          const wouldOverflow = Hdr.headerOverflowCrowded(bar);
          out.push({ page, barH: bar.getBoundingClientRect().height, searchW: s.width, searchC: s.x + s.width / 2, colC, leftW, rightW, hidden, wouldOverflow, viaMap: Hdr.headerOverflowHidden('tab-' + page), roomy, items, crumbW: cb.width, crumbOver: crumb.scrollWidth - crumb.clientWidth, navW: nav.width, kids });
        }
        return out;
      })()`);
      assert.equal(measured.length, Object.keys(HEADS).length, `every header measured at ${W}px`);
      for (const m of measured) {
        assert.equal(Math.round(m.barH), 56, `${m.page} at ${W}px: the header keeps its one height`);
        assert.ok(Math.round(m.searchW) >= 360 && Math.round(m.searchW) <= 520, `${m.page} at ${W}px: the grid sizes the bar 360 to 520px (${Math.round(m.searchW)}px)`);
        // Exactly centred over the column, always here (no fallback needed without the window-buttons gap);
        // the move is half the side difference wherever a side falls back (the band test proves that path).
        const off = Math.abs(m.searchC - m.colC);
        assert.ok(Math.abs(off - Math.abs(m.leftW - m.rightW) / 2) <= 1.5, `${m.page} at ${W}px: the move is half the side difference (${off.toFixed(1)}px off, sides ${m.leftW.toFixed(0)}/${m.rightW.toFixed(0)})`);
        if (!m.roomy) assert.ok(off <= 2, `${m.page} at ${W}px: exactly centred within 2px (${off.toFixed(1)}px off)`);
        else assert.equal(m.hidden.length, m.items, `${m.page} at ${W}px: a fallback means everything yielded first (${m.hidden.join(', ')})`);
        assert.deepEqual(m.viaMap, m.hidden, `${m.page} at ${W}px: the ⋯ menu reads the hidden keys`);
        for (const k of m.kids) {
          if (!k.vis) continue;
          // Nothing overlaps the bar, ever; the grid's own gaps keep every 12px (buttons and chrome alike;
          // half a pixel of breath for fractional track edges).
          const overlaps = k.left < m.searchC + m.searchW / 2 && k.right > m.searchC - m.searchW / 2;
          assert.ok(!overlaps, `${m.page} at ${W}px: ${k.key ?? 'chrome'} never touches the bar`);
          assert.ok(k.left - (m.searchC + m.searchW / 2) >= 11.5, `${m.page} at ${W}px: ${k.key ?? 'chrome'} keeps 12px`);
        }
        // One by one from the least used: a hidden order never hides while a lower one shows.
        const orders = new Map(m.kids.filter((k) => k.key).map((k) => [k.key, Number(k.order)]));
        const hiddenOrders = m.hidden.map((k) => orders.get(k));
        const shownOrders = m.kids.filter((k) => k.key && k.vis).map((k) => Number(k.order));
        if (hiddenOrders.length && shownOrders.length) assert.ok(Math.max(...hiddenOrders) <= Math.min(...shownOrders), `${m.page} at ${W}px: least used yields first (${m.hidden.join(', ')})`);
        // A fallback ⋯ shows exactly while it carries something.
        const hasFallback = HEADS[m.page].includes('data-overflow-fallback');
        if (hasFallback) {
          const shown = m.kids.some((k) => k.fallback);
          assert.equal(shown, m.hidden.length > 0, `${m.page} at ${W}px: the fallback ⋯ shows exactly while carrying`);
        }
        // Yield exactly while crowded: hidden buttons mean everything shown crowds its cell, and vice versa.
        assert.equal(m.hidden.length > 0, m.wouldOverflow, `${m.page} at ${W}px: buttons yield exactly while their side crowds its cell (${m.hidden.join(', ') || 'nothing hid'})`);
        // The left side: ← → + never hide, and a crumb longer than its cell clips without dots by itself.
        assert.ok(m.navW > 90, `${m.page} at ${W}px: the way back never hides (${m.navW.toFixed(0)}px)`);
        if (m.page === 'long-crumb' && W >= 1600) assert.ok(m.crumbOver > 0, `the long crumb clips without dots at ${W}px (${m.crumbOver.toFixed(0)}px clipped, full path on hover)`);
        if (m.page === 'long-crumb') assert.deepEqual(m.hidden, [], `the long crumb needs no fallback at ${W}px: nothing hid`);
      }
      // By name, where the margins are wide past any font: centring wins, the most used stays to the last.
      const at = (page) => measured.find((m) => m.page === page).hidden.sort();
      if (W === 1219) {
        assert.deepEqual(at('projects'), ['new-project', 'weekly-review'], 'Projects at 1219: both yield for the exact centre, least used first');
        assert.deepEqual(at('today'), ['start-template'], 'Today at 1219: its action rides in the ⋯');
        assert.deepEqual(at('bare'), [], 'a bare bar at 1219: nothing to yield');
        // Since the avatar left the header (20 Nov 2026) a note's two buttons fit at 1219 (was: Read yielded).
        assert.deepEqual(at('note'), [], 'a note at 1219: Share and Read both fit');
        assert.deepEqual(at('project-facts'), ['fields', 'publish'], 'a project Facts at 1219: Fields and Publish yield, Share stays (the Ask chip’s room)');
        assert.deepEqual(at('locked'), ['lock-now', 'new-secret', 'unlocked'], 'Locked at 1219: all yield, New secret last');
      }
      if (W === 1440) {
        assert.deepEqual(at('projects'), ['weekly-review'], 'Projects at 1440: Weekly review yields, New project stays (the Ask chip’s room)');
        assert.deepEqual(at('today'), [], 'Today at 1440: back');
        assert.deepEqual(at('note'), [], 'a note at 1440: Share and Read both fit');
        assert.deepEqual(at('media'), [], 'Media at 1440: its one icon fits again');
      }
      if (W === 1600) {
        assert.deepEqual(at('projects'), [], 'Projects at 1600: both back (the Ask chip’s room)');
        assert.deepEqual(at('today'), [], 'Today at 1600: back');
        assert.deepEqual(at('project-overview'), [], 'a project at 1600: all back');
        assert.deepEqual(at('note'), [], 'a note at 1600: Share and Read fit');
        assert.deepEqual(at('locked'), ['unlocked'], 'Locked at 1600: the status yields, Lock now and New secret stay');
      }
      if (W === 2000) {
        assert.deepEqual(at('projects'), [], 'Projects at 3456 wide: both back');
        assert.deepEqual(at('today'), [], 'Today at 3456 wide: back');
        assert.deepEqual(at('note'), [], 'a note at 3456 wide: Share and Read fit');
      }
    }
    ws.close();
  } finally {
    child.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── live: the band gap forces the fallback columns; a narrow window squeezes (Round 6) ─────────────────
// The real window's band gap once ballooned (a frozen overlay rect) and crushed the bar to 240px through
// the width steps. Round 4's trusted width caps the gap (window-buttons-87 pins the fallback), and the gap
// lives inside the right cell, so it only pushes the buttons left: with the live 138px gap at 1219 the bare
// side cannot fit its equal cell, so it falls back to max-content with everything yielded (the least move, ~27px
// since the avatar left the header); with the side bar hidden the way back carries a fourth button and the left
// cell cannot hold it, so both sides fall back; at 1920 everything fits and the bar is exactly centred.
// Past the trusted cap cannot
// occur; the squeeze path (a window too narrow for the bare sides) is proven at a narrow window instead: the
// 40px button, everything yieldable in the ⋯, the ⋯ itself whole and clickable, never overlapping, never
// covering the way back.
test('a live band gap falls back by the least move, and a narrow window squeezes last', async () => {
  assert.ok(existsSync(SHELL), `no headless Chromium (HEADLESS_SHELL): ${SHELL}`);
  const WebSocket = require('ws');
  const css = stylesheets();
  const dir = mkdtempSync(path.join(tmpdir(), 'nv-header-balloon-'));
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  await build({ input: path.join(root, 'src/renderer/src/lib/headerOverflow.ts'), platform: 'browser', output: { file: path.join(dir, 'hdr.mjs'), format: 'iife', name: 'Hdr' }, logLevel: 'silent' });
  const lib = readFileSync(path.join(dir, 'hdr.mjs'), 'utf8');
  const bar = (page, cls, style, right) => `<div class="topbar${cls}" data-page="${page}"${style ? ` style="${style}"` : ''}>
  <div class="topbar-left"><div class="view-nav">${page.startsWith('sideless') ? `<button class="navbtn" aria-label="Show the left side">${icon()}</button>` : ''}<button class="navbtn" aria-label="Back" disabled>←</button><button class="navbtn" aria-label="Forward" disabled>→</button><button class="navbtn" aria-label="New">+</button></div>
  <div class="crumb" title="Projects/Harbour/Launch plan.md">${CRUMB}</div></div>
  <button class="top-search" aria-label="Commands, pages and search">${icon()}<span class="clip">Ask or find anything</span><kbd>Ctrl+K</kbd></button>
  <div class="right">${right}</div>
</div>`;
  const html = `<!doctype html>
<html lang="en-AU" data-theme="light">
<head><meta charset="utf-8"><style>${css}</style></head>
<body>
<div class="app" data-platform="win32"><div class="ribbon"></div><aside class="sidebar left side" style="width:292px" aria-label="Places and notes"></aside><main class="main">
${bar('singleton-live', ' drag is-band controls-gap', '--wbtn-w: 138px', HEADS.today)}
${bar('multi-live', ' drag is-band controls-gap', '--wbtn-w: 138px', HEADS.projects)}
${bar('sideless-live', ' drag is-band controls-gap', '--wbtn-w: 138px', HEADS.projects)}
${bar('singleton-narrow', '', '', HEADS.today)}
${bar('multi-narrow', '', '', HEADS.projects)}
</main></div>
</body>
</html>`;
  const file = path.join(dir, 'balloon.html');
  writeFileSync(file, html);
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
    await send('Page.navigate', { url: pathToFileURL(file).href });
    let ready = false;
    for (let i = 0; i < 60 && !ready; i++) {
      await sleep(150);
      try {
        ready = await ev(`document.querySelectorAll('.topbar').length === 5`);
      } catch {}
    }
    assert.ok(ready, 'all five band bars drew');
    await ev(lib);
    for (const [W, H] of [[1219, 709], [1920, 1117], [700, 600]]) {
      await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
      await sleep(300);
      const measured = await ev(`(() => {
        const out = [];
        for (const el of document.querySelectorAll('.topbar')) {
          const page = el.dataset.page;
          // Forced, as ViewHeader's resize path does (t102, 9 Nov 2026): the widths moved but the words
          // did not, so the settled check would keep the last width's state — a resize always forces.
          const hidden = Hdr.layoutHeaderOverflow(el, 'tab-' + page, true);
          // Settled (t102/t146): laying the same bar out again without force keeps the same state.
          const again = Hdr.layoutHeaderOverflow(el, 'tab-' + page);
          const t = el.getBoundingClientRect();
          const s = el.querySelector('.top-search').getBoundingClientRect();
          const leftW = el.querySelector('.topbar-left').getBoundingClientRect().width;
          const rightW = el.querySelector(':scope .right').getBoundingClientRect().width;
          const nav = el.querySelector('.view-nav').getBoundingClientRect();
          const items = el.querySelectorAll(':scope .right [data-overflow]').length;
          const kids = [...el.querySelector(':scope .right').children].map((k) => {
            const b = k.getBoundingClientRect();
            const vis = b.width > 0 && getComputedStyle(k).display !== 'none';
            const fb = k.hasAttribute('data-overflow-fallback') && k.classList.contains('is-shown');
            return { key: k.dataset.overflow ?? k.getAttribute('aria-label') ?? null, vis, fb, left: b.x, width: b.width, right: b.x + b.width };
          });
          out.push({ page, searchW: s.width, searchL: s.x, searchR: s.x + s.width, searchC: s.x + s.width / 2, topC: t.x + t.width / 2, leftW, rightW, navR: nav.x + nav.width, hidden, again, items, squeezed: el.classList.contains('is-squeezed'), lr: el.classList.contains('is-left-roomy'), rr: el.classList.contains('is-right-roomy'), kids });
        }
        return out;
      })()`);
      // The band bars at full widths; the plain bars at the narrow window.
      const pages = W === 700 ? ['singleton-narrow', 'multi-narrow'] : ['singleton-live', 'multi-live', 'sideless-live'];
      for (const m of measured.filter((x) => pages.includes(x.page))) {
        assert.deepEqual(m.again, m.hidden, `${m.page} at ${W}px: settled, the same bar keeps its state`);
        const off = Math.abs(m.searchC - m.topC);
        // The move is half the side difference, exactly (the bar's centre sits half the difference off the
        // bar's middle); without a fallback the bar is exactly centred (half a pixel of breath for
        // fractional track edges on the gaps).
        if (!m.squeezed) assert.ok(Math.abs(off - Math.abs(m.leftW - m.rightW) / 2) <= 2, `${m.page} at ${W}px: the least move (${off.toFixed(1)}px off, sides ${m.leftW.toFixed(0)}/${m.rightW.toFixed(0)})`);
        if (!m.lr && !m.rr && !m.squeezed) assert.ok(off <= 2, `${m.page} at ${W}px: exactly centred within 2px (${off.toFixed(1)}px off)`);
        assert.ok(m.searchL - m.navR >= 11.5, `${m.page} at ${W}px: the bar keeps 12px from ← → + (${(m.searchL - m.navR).toFixed(1)}px)`);
        for (const k of m.kids) {
          if (!k.vis) continue;
          assert.ok(!(k.left < m.searchR && k.right > m.searchL), `${m.page} at ${W}px: ${k.key ?? 'chrome'} never touches the bar`);
          assert.ok(k.left - m.searchR >= 11.5, `${m.page} at ${W}px: ${k.key ?? 'chrome'} keeps 12px`);
        }
        if (m.page.endsWith('live')) {
          // The trusted gap: the floor holds, buttons yield least-used-first, no squeeze.
          assert.ok(Math.round(m.searchW) >= 360 && Math.round(m.searchW) <= 520, `${m.page} at ${W}px: the bar keeps 360–520px with the live gap (${Math.round(m.searchW)}px)`);
          assert.equal(m.squeezed, false, `${m.page} at ${W}px: no squeeze with the live gap`);
          if (W === 1219) {
            // The in-cell 144px gap crowds the right side, so it yields everything and falls back to its
            // max-content column; the left cell that leaves still holds the way back, so the left never falls
            // back: the least move, ~27px since the avatar left the header (20 Nov 2026; ~57px when both sides
            // fell back), never an overlap. ← → + never hide either way (updated 23 Nov 2026).
            assert.ok(m.navR <= m.searchL - 11.5, `${m.page} at ${W}px: the way back shows whole, clear of the bar`);
            assert.equal(m.rr, true, `${m.page} at ${W}px: the right side falls back with everything yielded`);
            assert.equal(m.hidden.length, m.items, `${m.page} at ${W}px: everything yielded before the fallback (${m.hidden.join(', ')})`);
            if (m.page.startsWith('sideless')) {
              // Four buttons in the way back crowd the left cell the right's fallback left: it falls back too.
              assert.equal(m.lr, true, `${m.page} at ${W}px: the left side falls back (the way back never hides)`);
            } else {
              assert.equal(m.lr, false, `${m.page} at ${W}px: the left cell still holds the way back`);
              assert.ok(off >= 17 && off <= 38, `${m.page} at ${W}px: the least move is ~27px (${off.toFixed(1)}px off)`);
            }
            if (!m.page.startsWith('singleton')) assert.deepEqual(m.hidden.sort(), ['new-project', 'weekly-review'], `${m.page} at ${W}px: the gap crowds both buttons out, least-used-first`);
            else assert.deepEqual(m.hidden, ['start-template'], `${m.page} at ${W}px: the singleton yields into its ⋯`);
          } else {
            assert.equal(m.lr, false, `${m.page} at ${W}px: no left fallback at room`);
            assert.equal(m.rr, false, `${m.page} at ${W}px: no right fallback at room`);
            if (!m.page.startsWith('singleton')) assert.deepEqual(m.hidden, [], `${m.page} at ${W}px: both fit beside the live gap (the Ask chip’s room)`);
            else assert.deepEqual(m.hidden, [], `${m.page} at ${W}px: room for everything beside the live gap`);
          }
        } else {
          // Too narrow for the bare sides: everything yieldable hides first, then the 40px button (the
          // squeeze sizes every track itself, so no fallback stays marked).
          assert.equal(m.hidden.length, m.items, `${m.page} at ${W}px: everything yieldable hid (${m.hidden.join(', ')})`);
          assert.equal(m.squeezed, true, `${m.page} at ${W}px: squeezed to the 40px button`);
          assert.equal(Math.round(m.searchW), 40, `${m.page} at ${W}px: the 40px search button`);
          assert.equal(m.lr, false, `${m.page} at ${W}px: squeezed, no left fallback marked`);
          assert.equal(m.rr, false, `${m.page} at ${W}px: squeezed, no right fallback marked`);
        }
        // The ⋯ carries what hid and stays whole: the fallback shows exactly while carrying.
        if (m.page.startsWith('singleton')) {
          assert.equal(m.kids.some((k) => k.fb), m.hidden.length > 0, `${m.page} at ${W}px: the fallback ⋯ shows exactly while carrying`);
          if (m.squeezed) assert.equal(Math.round(m.kids.find((k) => k.fb).width), 32, `${m.page} at ${W}px: the squeezed ⋯ stays whole`);
        } else {
          const more = m.kids.find((k) => k.key === 'More');
          assert.ok(more && more.vis, `${m.page} at ${W}px: the own ⋯ stays visible`);
          if (m.squeezed) assert.equal(Math.round(more.width), 32, `${m.page} at ${W}px: the squeezed ⋯ stays whole`);
        }
      }
    }
    ws.close();
  } finally {
    child.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});
