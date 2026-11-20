// node --test tests/sidebar-overflow.test.mjs — the left bar never scrolls sideways (9.5 polished,
// 2 Nov 2026: the side bar shows a horizontal scrollbar along its foot on Home, Import and Settings
// at 1440 and 1280 wide). The bar is drawn in headless Chromium at 1280px and 1440px with the
// window's real stylesheets, in the same order the window loads them; its scrollWidth must never
// run past its clientWidth, at the usual 292px and dragged to its 200px narrowest, standing alone
// and inside the former host app (the former host app/Vault/Bot switch), short and tall enough to
// scroll upright. Fails without the fix (the resize handle's 3px overhang, and the switch row's
// 36px at 200px).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
// The debugger lives on this machine: past any proxy the shell sets.
process.env.no_proxy = [process.env.no_proxy, '127.0.0.1,localhost'].filter(Boolean).join(',');
process.env.NO_PROXY = [process.env.NO_PROXY, '127.0.0.1,localhost'].filter(Boolean).join(',');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SHELL = process.env.HEADLESS_SHELL || (process.env.HOME || '') + '/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell';

// The window's stylesheets in the order it loads them (main.tsx), so the cascade is the window's.
function stylesheets() {
  const order = [...read('src/renderer/src/main.tsx').matchAll(/import '\.\/(styles\.css|styles\/[^']+\.css)';/g)].map((m) => m[1]);
  assert.ok(order.length > 10 && order[0] === 'styles.css', `${order.length} stylesheets in the window's order`);
  assert.ok(order.includes('styles/kit.css'), 'the kit styles are loaded');
  return order.map((f) => `/* ${f} */\n${read(`src/renderer/src/${f}`)}`).join('\n');
}

const icon = (s = 16) => `<svg width="${s}" height="${s}" viewBox="0 0 16 16" aria-hidden="true"><rect width="16" height="16" fill="currentColor"/></svg>`;
const srow = (label, extra = '') => `<button class="srow">${icon()}<span class="clip">${label}</span>${extra}</button>`;
const packRow = (label) => `<button class="srow"><span class="gtile xs" style="width:20px;height:20px">${icon(12)}</span><span class="clip">${label}</span></button>`;

// The bar as Sidebars.tsx draws it for the home panel: the brand row, the rows
// (one pack name far longer than the room, as a person's own), the person and
// Settings pinned at the foot, and the resize handle on its edge.
function bar({ width, embedded, tall }) {
  let rows = [
    srow('Search', '<span class="key">Ctrl+K</span>'),
    srow('Today', '<span class="n">4</span>'),
    srow('Home'),
    srow('Inbox', '<span class="n">3</span>'),
    '<div class="slabel">Projects</div>',
    srow('Projects', '<span class="n">12</span>'),
    srow('Meetings'),
    '<div class="slabel">Packs · 2 switched on</div>',
    packRow('Health and fitness tracker with a very long pack name'),
    packRow('Finance'),
    '<div class="slabel">Keep</div>',
    srow('Notes'),
    srow('People'),
    srow('More'),
  ].join('\n');
  if (tall) for (let i = 0; i < 40; i++) rows += `\n${packRow(`Extra pack row number ${i} with words`)}`;
  const head = embedded
    ? `<div class="places-head drag"><div class="lens-switch" role="tablist" aria-label="Host, Ironleaf or chat bot"><button role="tab" class="lens-option">the host app</button><button role="tab" class="lens-option is-on">Vault</button><button role="tab" class="lens-option">Bot</button></div><button class="places-hide" aria-label="Hide the left side">${icon()}</button></div>`
    : '';
  return `<aside class="sidebar left side" style="width:${width}px" aria-label="Places and notes">${head}
<div class="vault"><span class="mark">${icon(38)}</span><div class="brand-words"><svg class="wm wm-l" viewBox="-20 -58 1162.1 200" aria-hidden="true"><rect width="1162" height="200" fill="currentColor"/></svg><small class="clip">Madeup Vault With A Long Name</small></div></div>
<button class="btn pri places-action">New</button>
<nav class="places-list" aria-label="Places">${rows}</nav>
<div class="sp"></div>
<div class="places-foot"><button class="srow places-me"><span class="places-ava">MW</span><span class="clip">Madeup Person With A Long Name</span></button>${srow('Settings')}</div>
<div class="side-resizer left"></div>
</aside>`;
}

function harness(css, aside) {
  return `<!doctype html>
<html lang="en-AU">
<head><meta charset="utf-8"><style>${css}</style></head>
<body>
<div class="app" data-platform="linux" style="height:900px"><div class="ribbon"></div>${aside}<main class="main"></main></div>
</body>
</html>
`;
}

async function freePort() {
  const net = await import('node:net');
  return new Promise((resolve) => {
    const s = net.createServer(() => {});
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}

test('the left bar drawn at 1280px and 1440px: never wider than its room', async () => {
  assert.ok(existsSync(SHELL), `no headless Chromium (HEADLESS_SHELL): ${SHELL}`);
  const WebSocket = require('ws');
  const css = stylesheets();
  const dir = mkdtempSync(path.join(tmpdir(), 'nv-sidebar-overflow-'));
  const cases = [
    { name: 'usual width', bar: { width: 292, embedded: false, tall: false } },
    { name: 'usual width, tall', bar: { width: 292, embedded: false, tall: true } },
    { name: 'dragged narrow', bar: { width: 200, embedded: false, tall: false } },
    { name: 'in the host app', bar: { width: 292, embedded: true, tall: false } },
    { name: 'in the host app, dragged narrow', bar: { width: 200, embedded: true, tall: false } },
  ];
  const files = new Map();
  for (const c of cases) {
    const file = path.join(dir, `${c.name.replace(/[^a-z]+/gi, '-').toLowerCase()}.html`);
    writeFileSync(file, harness(css, bar(c.bar)));
    files.set(c.name, file);
  }
  const port = await freePort();
  const child = spawn(SHELL, ['--headless', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${port}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
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
    for (const width of [1280, 1440]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
      for (const c of cases) {
        await send('Page.navigate', { url: pathToFileURL(files.get(c.name)).href });
        let ready = false;
        for (let i = 0; i < 60 && !ready; i++) {
          await sleep(150);
          try {
            ready = await ev(`!!document.querySelector('.sidebar.left .side-resizer')`);
          } catch {}
        }
        assert.ok(ready, `the bar drew at ${width}px (${c.name})`);
        const m = await ev(`(() => { const el = document.querySelector('.sidebar.left'); return { cw: el.clientWidth, sw: el.scrollWidth, ch: el.clientHeight, sh: el.scrollHeight }; })()`);
        assert.ok(m.sw - m.cw <= 1, `${c.name} at ${width}px: the bar runs ${m.sw - m.cw}px past its room (scroll ${m.sw} vs room ${m.cw})`);
        // The bar never scrolls (3 Nov 2026): a tall bar keeps its overflow inside the places list, which folds rows
        // into More to fit (Places.tsx).
        if (c.bar.tall) {
          assert.ok(m.sh - m.ch <= 1, `${c.name} at ${width}px: the tall bar scrolls (${m.sh} vs ${m.ch})`);
          const oy = await ev(`getComputedStyle(document.querySelector('.sidebar.left')).overflowY`);
          assert.ok(!/auto|scroll/.test(oy), `${c.name} at ${width}px: the bar may scroll (overflow-y ${oy})`);
        }
        if (c.bar.embedded) {
          const hide = await ev(`(() => { const side = document.querySelector('.sidebar.left'); const s = side.getBoundingClientRect(); const h = document.querySelector('.places-hide').getBoundingClientRect(); return Math.round(h.right - s.left - s.width); })()`);
          assert.ok(hide <= 1, `${c.name} at ${width}px: the hide button hangs ${hide}px past the bar`);
        }
      }
    }
    ws.close();
  } finally {
    child.kill('SIGKILL');
    rmSync(dir, { recursive: true, force: true });
  }
});
