// node --test tests/note-scroll-quiet.test.mjs — a note's scrollbar stays quiet until hovered or
// scrolling (Nov 2026 review: the note's pale blue bar ran down between the note and the slim side
// panel and read as a divider line down the middle of a wide window; a user complained about that
// line). The bar sits at the far edge of its scrolling area already, so the fix is quietness: the
// thumb is transparent until the scroller is hovered or moving, in every view of a note and a doc
// (Reading, Live Preview and Source share the two scrollers: .reading and CodeMirror's .cm-scroller).
// The bar still works throughout: it shows while scrolling however started. Each failing check fails
// without its fix.
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
const root = path.join(import.meta.dirname, '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SHELL = process.env.HEADLESS_SHELL || (process.env.HOME || '') + '/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell';
// The window's stylesheets in the order it loads them, then the note view's own sheets.
const stylesheets = () => {
  const order = [...read('src/renderer/src/main.tsx').matchAll(/import '\.\/(styles\.css|styles\/[^']+\.css)';/g)].map((m) => m[1]);
  order.push('styles/note-context.css', 'styles/w2b.css');
  assert.ok(order.length > 10 && order[0] === 'styles.css', `${order.length} stylesheets in the window's order`);
  return order.map((f) => `/* ${f} */\n${read(`src/renderer/src/${f}`)}`).join('\n');
};

test('the note’s scrollers keep a quiet thumb that shows on hover or while moving', () => {
  const css = read('src/renderer/src/styles/note-context.css');
  assert.ok(/\.nv-note-main \.cm-scroller,\s*\.nv-note-main \.reading\s*\{[^}]*scrollbar-color:\s*transparent transparent/s.test(css), 'quiet by default in both scrollers, both engines’ standard rule');
  assert.ok(/::-webkit-scrollbar-thumb\s*\{[^}]*background:\s*transparent/s.test(css), 'quiet in Chromium’s own rule too');
  assert.ok(/\.is-scrolling[^{]*\{[^}]*scrollbar-color:\s*var\(--scroll\)/s.test(css), 'shown while moving');
  assert.ok(/:hover[^{]*\{[^}]*scrollbar-color:\s*var\(--scroll\)/s.test(css), 'shown on hover');
  assert.ok(!/\.nv-note-main[^{]*:focus-within/.test(css), 'never pinned on by focus: typing would show it always');
  assert.ok(read('src/renderer/src/editor/NoteEditor.tsx').includes('quietScroll(view.scrollDOM)'), 'Live Preview and Source mark their scroller while it moves');
  assert.ok(read('src/renderer/src/views/NoteView.tsx').includes('quietScroll(readingScroll.current)'), 'Reading marks its scroller while it moves');
});

test('measured: quiet at rest, shown on hover and while scrolling, still usable', { timeout: 420000 }, async () => {
  assert.ok(existsSync(SHELL), `no headless Chromium (HEADLESS_SHELL): ${SHELL}`);
  const WebSocket = require('ws');
  const dir = mkdtempSync(path.join(tmpdir(), 'nv-note-quiet-'));
  const paras = Array.from({ length: 40 }, (_, i) => `<p>Paragraph ${i + 1}: the winter menu tasting went well on Thursday afternoon. The pumpkin soup needs more pepper and a longer roast on the seeds, while the leek and potato is ready for the menu cards.</p>`).join('\n');
  const lines = Array.from({ length: 160 }, (_, i) => `<div class="cm-line">Line ${i + 1}: chase the spare tills still on the old build before Friday</div>`).join('\n');
  const page = (css, main, cls) => `<!doctype html>
<html lang="en-AU" data-theme="light" data-palette="bright">
<head><meta charset="utf-8"><style>${css}</style>
<style>html, body { margin: 0; height: 100%; } body { background: var(--bg); } .note-view { height: 100vh; display: flex; flex-direction: column; } .view-head-mock { height: 56px; flex: none; border-bottom: 1px solid var(--border); display: flex; align-items: center; padding: 0 20px; font-weight: 600; } .note-view.${cls} .nv-note-main { } .cm-scroller { overflow-y: auto; overflow-x: hidden; height: 100%; }</style>
</head>
<body><div class="note-view ${cls}"><div class="view-head-mock">Winter menu tasting notes</div>
<div class="nv-note-layout"><div class="nv-note-main">${main}</div>
<div class="nv-rail is-shut"><div class="nv-rail-head"><span>Context</span></div></div>
</div></div></body></html>`;
  const css = stylesheets();
  const reading = path.join(dir, 'reading.html');
  const live = path.join(dir, 'live.html');
  writeFileSync(reading, page(css, `<div class="reading"><div class="reading-page markdown reading-body"><h1>Winter menu tasting notes</h1>${paras}</div></div>`, 'readable'));
  writeFileSync(live, page(css, `<div class="note-editor"><div class="cm-editor"><div class="cm-scroller"><div class="cm-content">${lines}</div></div></div></div>`, 'readable'));
  // The real quiet helper, built from the window's own source and run in the page.
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  await build({ input: path.join(root, 'src/renderer/src/lib/quietScroll.ts'), platform: 'browser', output: { file: path.join(dir, 'q.js'), format: 'iife', name: 'QS' }, logLevel: 'silent' });
  const helper = readFileSync(path.join(dir, 'q.js'), 'utf8');
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
    const quiet = 'rgba(0, 0, 0, 0) rgba(0, 0, 0, 0)';
    for (const [W, H] of [[3456, 1408], [1920, 1117]]) {
      for (const [tag, file, sel] of [['reading', reading, '.reading'], ['live', live, '.cm-scroller']]) {
        await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
        await send('Page.navigate', { url: pathToFileURL(file).href });
        let ready = false;
        for (let i = 0; i < 60 && !ready; i++) {
          await sleep(150);
          try {
            ready = await ev(`!!document.querySelector('${sel}')`);
          } catch {}
        }
        assert.ok(ready, `the ${tag} scroller drew at ${W}x${H}`);
        assert.ok(await ev(`(() => { const s = document.querySelector('${sel}'); return s.scrollHeight > s.clientHeight + 50; })()`), `the ${tag} scroller overflows at ${W}x${H}`);
        await ev(helper);
        await ev(`window.__unquiet = QS.quietScroll(document.querySelector('${sel}'))`);
        // Shown is the window's own bar colour, whatever the palette sets it to.
        const shown = await ev(`getComputedStyle(document.body).scrollbarColor`);
        assert.notEqual(shown, quiet);
        assert.equal(await ev(`getComputedStyle(document.querySelector('${sel}')).scrollbarColor`), quiet, `${tag} at ${W}x${H}: quiet at rest`);
        // Hovered: the bar shows; away again: quiet.
        const c = await ev(`(() => { const r = document.querySelector('${sel}').getBoundingClientRect(); return { x: r.x + r.width - 4, y: r.y + r.height / 2 }; })()`);
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(c.x), y: Math.round(c.y) });
        await sleep(250);
        assert.equal(await ev(`getComputedStyle(document.querySelector('${sel}')).scrollbarColor`), shown, `${tag} at ${W}x${H}: shown on hover`);
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 30, y: H - 30 });
        await sleep(250);
        // Scrolling however started: the bar shows while moving, then goes quiet — and the scroll worked.
        await ev(`(() => { const s = document.querySelector('${sel}'); s.scrollTop = 400; })()`);
        await sleep(250);
        assert.equal(await ev(`document.querySelector('${sel}').scrollTop`), 400, `${tag} at ${W}x${H}: the bar still scrolls while quiet`);
        assert.ok(await ev(`document.querySelector('${sel}').classList.contains('is-scrolling')`), `${tag} at ${W}x${H}: marked while moving`);
        assert.equal(await ev(`getComputedStyle(document.querySelector('${sel}')).scrollbarColor`), shown, `${tag} at ${W}x${H}: shown while moving`);
        await sleep(1300);
        assert.ok(!(await ev(`document.querySelector('${sel}').classList.contains('is-scrolling')`)), `${tag} at ${W}x${H}: unmarked when idle`);
        assert.equal(await ev(`getComputedStyle(document.querySelector('${sel}')).scrollbarColor`), quiet, `${tag} at ${W}x${H}: quiet again when idle`);
        await ev(`window.__unquiet()`);
      }
    }
    ws.close();
  } finally {
    child.kill('SIGKILL');
    rmSync(dir, { recursive: true, force: true });
  }
});
