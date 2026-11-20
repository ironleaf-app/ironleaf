// node --test tests/note-foot-focused.test.mjs — the foot jump lands in the focused pane (t28 follow-up,
// 8 Nov 2026, the call on the break-it job's question: `goToNoteFoot` read the whole document, so in
// splits it could land on the wrong pane). The workspace marks the focused pane .is-focused
// (src/renderer/src/views/Workspace.tsx GroupView); the jump stays inside it, waking and landing on its own
// foot. Outside the workspace (a lone foot, no panes) the whole document is the scope, as before. Proven with
// two real panes in the headless shell, the unfocused pane first: the real bundled jump moves the focused
// pane's foot into view and leaves the other pane untouched. Fails first: the jump lands on the first pane's
// foot, whatever is focused.
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
// The split's own words (3456x1408 is the window; 1219x709 a scaled screen): behaviour, not
// looks.
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SHELL = process.env.HEADLESS_SHELL || (process.env.HOME || '') + '/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell';

test('the jump stays inside the focused pane (two panes, the unfocused one first)', { timeout: 420000 }, async () => {
  assert.ok(existsSync(SHELL), `no headless Chromium (HEADLESS_SHELL): ${SHELL}`);
  // The window marks the focused pane .is-focused (GroupView): the jump's scope must be that pane.
  const view = read('src/renderer/src/views/Workspace.tsx');
  assert.ok(view.includes('is-focused'), 'the workspace marks its focused pane');
  const foot = read('src/renderer/src/components/NoteFoot.tsx');
  assert.ok(foot.includes("document.querySelector('.group.is-focused') ?? document"), 'the jump stays inside the focused pane, the document outside the workspace');
  // The real jump, built from the window's own source and run in the page.
  const dir = mkdtempSync(path.join(tmpdir(), 'nv-note-foot-'));
  try {
    const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
    const entry = path.join(dir, 'entry.ts');
    writeFileSync(entry, `import { goToNoteFoot } from ${JSON.stringify(path.join(root, 'src/renderer/src/components/NoteFoot.tsx'))};\n(window as unknown as { __go: typeof goToNoteFoot }).__go = goToNoteFoot;\n`);
    const assetStub = {
      name: 'asset-stub',
      resolveId: (id) => (id.endsWith('.css') || id.includes('?') ? '\0asset-stub' : null),
      load: (id) => (id === '\0asset-stub' ? 'export default "";\n' : null),
    };
    await build({ input: entry, platform: 'browser', plugins: [assetStub], output: { file: path.join(dir, 'go.js'), format: 'iife', name: 'NF' }, logLevel: 'silent' });
    const jump = readFileSync(path.join(dir, 'go.js'), 'utf8');
    // Two panes side by side, each a long note with its foot below the fold; the unfocused pane first, so the
    // old whole-document jump lands on it.
    const lines = (n) => Array.from({ length: 120 }, (_, i) => `<div class="cm-line">Line ${i + 1}: chase the old microphone stands still in the cupboard before Friday</div>`).join('\n');
    const pane = (tag, focused) => `<div class="split-cell"><section class="group${focused ? ' is-focused' : ''}" data-tag="${tag}"><div class="group-body"><div class="note-editor"><div class="cm-editor"><div class="cm-scroller" data-tag="${tag}"><div class="cm-content">${lines()}<div class="note-foot" data-tag="${tag}"><div class="linked">Linked list ${tag}</div></div></div></div></div></div></div></section></div>`;
    const page = (body) => `<!doctype html>
<html lang="en-AU"><head><meta charset="utf-8"><style>html, body { margin: 0; height: 100%; } .split { display: flex; height: 100vh; } .split-cell { flex: 1 1 50%; min-width: 0; display: flex; } .group { flex: 1; display: flex; min-height: 0; } .group-body { flex: 1; display: flex; min-height: 0; } .note-editor { flex: 1; display: flex; min-height: 0; } .cm-editor { flex: 1; display: flex; min-height: 0; } .cm-scroller { flex: 1; overflow-y: auto; min-height: 0; } .cm-line { height: 24px; } .note-foot { padding: 24px; background: #eef; }</style></head>
<body>${body}<script>${jump}</script></body></html>`;
    const two = path.join(dir, 'two.html');
    writeFileSync(two, page(`<div class="split row">${pane('left', false)}${pane('right', true)}</div>`));
    const lone = path.join(dir, 'lone.html');
    writeFileSync(lone, page(`<div style="display:flex;height:100vh"><div style="flex:1;display:flex;min-height:0"><div class="cm-scroller" data-tag="lone"><div class="cm-content">${lines()}<div class="note-foot" data-tag="lone"><div class="linked">Linked list lone</div></div></div></div></div></div>`));
    const WebSocket = require('ws');
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
      for (const [W, H] of [[1219, 709], [1920, 1117]]) {
        await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
        await send('Page.navigate', { url: pathToFileURL(two).href });
        let ready = false;
        for (let i = 0; i < 60 && !ready; i++) {
          await sleep(150);
          try {
            ready = await ev(`typeof window.__go === 'function' && !!document.querySelector('.note-foot[data-tag="right"]')`);
          } catch {}
        }
        assert.ok(ready, `the two panes and the real jump drew at ${W}x${H}`);
        assert.ok(await ev(`(() => { const s = document.querySelector('.cm-scroller[data-tag="right"]'); return s.scrollHeight > s.clientHeight + 50; })()`), `the focused pane overflows at ${W}x${H}`);
        await ev(`window.__go()`);
        await sleep(1200);
        // The focused pane's foot is in view; the other pane never moved.
        const seen = await ev(`(() => { const r = document.querySelector('.note-foot[data-tag="right"]').getBoundingClientRect(); return r.top >= 0 && r.top < window.innerHeight; })()`);
        assert.ok(seen, `${W}x${H}: the focused pane's foot is in view`);
        assert.equal(await ev(`document.querySelector('.cm-scroller[data-tag="left"]').scrollTop`), 0, `${W}x${H}: the unfocused pane never moved`);
        assert.ok((await ev(`document.querySelector('.cm-scroller[data-tag="right"]').scrollTop`)) > 0, `${W}x${H}: the focused pane did the moving`);
        // A lone foot, no panes: the jump still lands on it, as before.
        await send('Page.navigate', { url: pathToFileURL(lone).href });
        ready = false;
        for (let i = 0; i < 60 && !ready; i++) {
          await sleep(150);
          try {
            ready = await ev(`typeof window.__go === 'function' && !!document.querySelector('.note-foot[data-tag="lone"]')`);
          } catch {}
        }
        assert.ok(ready, `the lone foot and the real jump drew at ${W}x${H}`);
        assert.ok(await ev(`(() => { const s = document.querySelector('.cm-scroller[data-tag="lone"]'); return s.scrollHeight > s.clientHeight + 50; })()`), `the lone note overflows at ${W}x${H}`);
        await ev(`window.__go()`);
        await sleep(1200);
        assert.ok((await ev(`document.querySelector('.cm-scroller[data-tag="lone"]').scrollTop`)) > 0, `${W}x${H}: a lone foot still lands`);
      }
      ws.close();
    } finally {
      child.kill('SIGKILL');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
