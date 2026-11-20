// node --test tests/publish-settings-fit.test.mjs — Settings › Publish fits (9.0 w122publish round 2, 31 Oct 2026,
// the reviewer: the "Your sites" description ran down the page one letter wide, the site card was pushed right and
// its last buttons cut off: the sites sat in a side-by-side Settings row whose control never wraps). The page is
// drawn in headless Chromium at 900px and 1440px wide with the window's real stylesheets, in the same order the
// window loads them; every text box must be at least 120px wide, nothing may run sideways past the window, and every
// action button must be fully on show.
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

// The Your-sites row keeps the Settings stacked layout (heading and description full width, the sites under them),
// the fix for the one-letter column; the harness below draws that same row.
test('Your sites keeps the stacked Settings row, with quiet actions', () => {
  const src = read('src/renderer/src/components/PublishSettings.tsx');
  assert.match(src, /<Row title="Your sites"[^>]*\bstacked\b/, 'the Your-sites row is stacked');
  assert.doesNotMatch(src, /<Row title="Your sites"[^>]*\bwide\b/, 'never the side-by-side row again');
  assert.doesNotMatch(src, /button danger/, 'no solid red blocks in Settings (danger lives on hover and confirm)');
});

const SHELL = process.env.HEADLESS_SHELL || (process.env.HOME || '') + '/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell';

// The window's stylesheets in the order it loads them (main.tsx), so the cascade is the window's.
function stylesheets() {
  const order = [...read('src/renderer/src/main.tsx').matchAll(/import '\.\/(styles\.css|styles\/[^']+\.css)';/g)].map((m) => m[1]);
  assert.ok(order.length > 10 && order[0] === 'styles.css', `${order.length} stylesheets in the window's order`);
  assert.ok(order.includes('styles/site-publish.css'), 'the publish styles are loaded');
  return order.map((f) => `/* ${f} */\n${read(`src/renderer/src/${f}`)}`).join('\n');
}

// Settings › Publish as PublishSettings draws it: the New-site row, then Your sites with one published site (five
// actions, the widest the row gets) and the long folder line from a real publish.
function harness(css) {
  return `<!doctype html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<style>${css}</style>
</head>
<body>
<div class="settings settings-page">
<div class="settings-nav"><div class="settings-nav-title">Settings</div><button type="button">General</button><button type="button" class="active">Publish</button></div>
<div class="settings-body">
<h1>Publish</h1>
<p class="setting-words">Your notes as websites: what goes in each, where each goes.</p>
<div class="setting-row" data-setting="New site">
<div class="setting-text"><div class="setting-title">New site</div><div class="setting-hint">Chosen pages as a finished site, in a folder or on your own host.</div></div>
<div class="setting-control"><span class="ctl"><button type="button" class="button">New site…</button></span></div>
</div>
<div class="setting-row stacked" data-setting="Your sites">
<div class="setting-text"><div class="setting-title">Your sites</div><div class="setting-hint">Every website kept: what is in it, where it goes, when it went.</div></div>
<div class="setting-control"><ul class="site-list"><li class="site-row">
<div class="site-words"><div class="site-name">Lemon cake</div><div class="site-detail">One page: Lemon cake</div><div class="site-detail hint">/tmp/nv-shots-w122-8UShbq/published · Published 31 Oct 2026</div></div>
<div class="site-actions"><button type="button" class="button">Open</button><button type="button" class="button">Republish</button><button type="button" class="button">Open site</button><button type="button" class="button quiet">Unpublish</button><button type="button" class="button quiet">Forget</button></div>
</li></ul></div>
</div>
</div>
</div>
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

test('Settings › Publish drawn at 900px and 1440px: no text under 120px, nothing cut off', async () => {
  assert.ok(existsSync(SHELL), `no headless Chromium (HEADLESS_SHELL): ${SHELL}`);
  const WebSocket = require('ws');
  const dir = mkdtempSync(path.join(tmpdir(), 'nv-publish-fit-'));
  const file = path.join(dir, 'publish.html');
  writeFileSync(file, harness(stylesheets()));
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
    for (const width of [900, 1440]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
      await send('Page.navigate', { url: pathToFileURL(file).href });
      let ready = false;
      for (let i = 0; i < 60 && !ready; i++) {
        await sleep(150);
        try {
          ready = await ev(`document.querySelectorAll('.site-actions .button').length === 5`);
        } catch {}
      }
      assert.ok(ready, `the page drew at ${width}px`);
      const boxes = await ev(`[...document.querySelectorAll('.setting-text, .setting-hint, .site-words, .site-name, .site-detail')].map((el) => ({ what: el.className.split(' ')[0] + (el.closest('[data-setting]') ? ' in ' + el.closest('[data-setting]').dataset.setting : ''), w: Math.round(el.getBoundingClientRect().width) }))`);
      assert.ok(boxes.length >= 8, `${boxes.length} text boxes measured at ${width}px`);
      for (const b of boxes) assert.ok(b.w >= 120, `${b.what} is ${b.w}px wide at ${width}px (under 120px)`);
      const overflow = await ev(`document.documentElement.scrollWidth - window.innerWidth`);
      assert.ok(overflow <= 1, `the page runs ${overflow}px past the window at ${width}px`);
      const cut = await ev(`[...document.querySelectorAll('.site-actions .button')].map((b) => { const r = b.getBoundingClientRect(); return { words: b.textContent, left: Math.round(r.left), right: Math.round(r.right), win: window.innerWidth }; })`);
      for (const b of cut) assert.ok(b.left >= -1 && b.right <= b.win + 1, `“${b.words}” cut off at ${width}px (${b.left} to ${b.right} in ${b.win})`);
    }
    ws.close();
  } finally {
    child.kill('SIGKILL');
    rmSync(dir, { recursive: true, force: true });
  }
});
