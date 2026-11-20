// node --test tests/folder-followups-systems.test.mjs — item 4 (8 Nov 2026):
// The Systems two-PC card reads plainly, the same treatment the bills card got
// tonight: no raw [[link]] brackets, the app's own radios, plain words.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
process.env.no_proxy = [process.env.no_proxy, '127.0.0.1,localhost'].filter(Boolean).join(',');
process.env.NO_PROXY = [process.env.NO_PROXY, '127.0.0.1,localhost'].filter(Boolean).join(',');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SHELL = process.env.HEADLESS_SHELL || (process.env.HOME || '') + '/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell';

const work = mkdtempSync(path.join(tmpdir(), 'nv-systems-card-'));
let cardJs;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const src = (p) => JSON.stringify(path.join(root, p));
  try {
    symlinkSync(path.join(root, 'node_modules'), path.join(work, 'node_modules'), 'junction');
  } catch {}
  const cardEntry = path.join(work, 'card.tsx');
  writeFileSync(
    cardEntry,
    [
      `import { createElement } from 'react';`,
      `import { createRoot } from 'react-dom/client';`,
      `import { SystemsConflictCard } from ${src('src/renderer/src/views/modules/life/SystemsPage.tsx')};`,
      `const w = window as unknown as Record<string, any>;`,
      `createRoot(document.getElementById('root')!).render(createElement(SystemsConflictCard, { conflict: w.__conflict, canEdit: w.__canEdit !== false }));`,
      `w.__ready = true;`,
      '',
    ].join('\n'),
  );
  const assetStub = {
    name: 'asset-stub',
    resolveId: (id) => (id.endsWith('.css') || id.includes('?') ? '\0asset-stub' : null),
    load: (id) => (id === '\0asset-stub' ? 'export default "";\n' : null),
  };
  await build({ input: cardEntry, platform: 'browser', plugins: [assetStub], output: { file: path.join(work, 'card.mjs'), format: 'esm', codeSplitting: false }, logLevel: 'silent' });
  cardJs = readFileSync(path.join(work, 'card.mjs'), 'utf8');
});
after(() => rmSync(work, { recursive: true, force: true }));

// A made-up service changed on two PCs: runs-on and depends-on differ as links, the rest agrees.
const conflictOf = () => ({
  kind: 'service',
  name: 'Photo library',
  path: 'Home/Systems and Home Lab/Services.md#photo-library',
  kept: { kind: 'Web app', runsOn: '[[Juniper]]', url: 'http://juniper.local:8001', port: '8001', status: 'Up', dependsOn: '[[Backups]]', runbook: '', checked: '2026-11-07', logins: '', note: '' },
  keptNote: null,
  others: [{ name: 'Photo library', cells: { kind: 'Web app', runsOn: '[[Socket box]]', url: 'http://juniper.local:8001', port: '8001', status: 'Up', dependsOn: '[[Backups]], [[Media scan]]', runbook: '[[Restart the library]]', checked: '2026-11-08', logins: '', note: '' }, note: null }],
});

function stylesheets() {
  const order = [...read('src/renderer/src/main.tsx').matchAll(/import '\.\/(styles\.css|styles\/[^']+\.css)';/g)].map((m) => m[1]);
  assert.ok(order.length > 10 && order[0] === 'styles.css', `${order.length} stylesheets in the window's order`);
  return order.map((f) => `/* ${f} */\n${read(`src/renderer/src/${f}`)}`).join('\n');
}

function harness(css, bundle, conflict, canEdit = true) {
  // The bundle inlines into the page, so its HTML-significant runs are escaped first (8 Nov 2026,
  // suite-green: shared/meeting-notes' <!--nv:voice…--> mark put the parser in escaped script state and the
  // module never ran, so the card never drew). `<\!--` and `<\/script` read the same in JS strings and patterns.
  const inline = bundle.replace(/<!--/g, '<\\!--').replace(/<\/script/gi, '<\\/script');
  return `<!doctype html>
<html lang="en-AU" data-theme="light" data-palette="bright">
<head><meta charset="utf-8"><style>${css}</style>
<style>html, body { margin: 0; } .nv-page { max-width: 860px; margin: 0 auto; padding: 24px; }</style>
</head>
<body><div class="app" data-platform="linux"><div class="nv-page"><div class="p87-body" id="root"></div></div></div>
<script>window.__calls = []; window.__conflict = ${JSON.stringify(conflict)}; window.__canEdit = ${canEdit ? 'true' : 'false'};
window.nv = { work: { call: (mod, name, args) => { window.__calls.push([mod, name, args]); return Promise.resolve({ words: 'Kept.' }); } }, index: { backlinks: () => Promise.resolve([]) } };</script>
<script type="module">${inline}</script>
</body></html>
`;
}

test('the Systems card reads its versions plainly, not raw cells', () => {
  const page = read('src/renderer/src/views/modules/life/SystemsPage.tsx');
  assert.ok(page.includes('SystemsConflictCard'), 'the card is exported for its test, like the bills card');
  // Compared and shown through plain words (a [[link]] reads as its name), never raw cells[k].
  assert.ok(!/v\.cells\[k\](?!\s*\?\?)/.test(page) || page.includes('cellOf') || page.includes('plainCell') || page.includes('linkName'), 'cells read through plain words, not raw');
  assert.ok(page.includes('linkName') || page.includes('plainCell') || page.includes('cellOf'), 'a link reads as its name');
});

test('the real Systems card draws both versions plainly, and nothing runs past its room', async () => {
  assert.ok(existsSync(SHELL), `no headless Chromium (HEADLESS_SHELL): ${SHELL}`);
  const WebSocket = require('ws');
  const css = stylesheets();
  const dir = mkdtempSync(path.join(tmpdir(), 'nv-systems-card-'));
  try {
    const page = path.join(dir, 'card.html');
    writeFileSync(page, harness(css, cardJs, conflictOf()));
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
      const send = (method, params = {}) =>
        new Promise((resolve) => {
          const i = id++;
          pending.set(i, resolve);
          ws.send(JSON.stringify({ id: i, method, params }));
        });
      const ev = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.value;
      await send('Page.enable');
      await send('Runtime.enable');
      const open = async (w, h, file) => {
        await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
        await send('Page.navigate', { url: pathToFileURL(file).href });
        let ready = false;
        for (let i = 0; i < 60 && !ready; i++) {
          await sleep(150);
          try {
            ready = await ev(`!!(window.__ready && document.querySelector('.sys-conflict-vers'))`);
          } catch {}
        }
        assert.ok(ready, `the card drew at ${w}x${h}`);
      };
      await open(1920, 1117, page);
      const m = await ev(`(() => {
        const vers = [...document.querySelectorAll('.sys-conflict-ver')];
        const facts = vers.map((v) => [...v.querySelectorAll('.sys-conflict-facts li')].map((li) => li.innerText.replace(/\\n/g, ' ')));
        return {
          vers: vers.map((v) => v.querySelector('.sys-conflict-head').innerText.trim()),
          facts,
          btn: document.querySelector('.sys-actions .button').innerText.trim(),
          all: document.querySelector('.sys-conflict-vers').innerText,
        };
      })()`);
      assert.deepEqual(m.vers, ['Shown now', 'The other version'], 'each version headed plainly');
      assert.ok(m.facts[0].some((f) => /Runs on Juniper$/.test(f)) && m.facts[1].some((f) => /Runs on Socket box$/.test(f)), 'each runs-on reads as its name');
      assert.ok(m.facts[1].some((f) => /Depends on Backups, Media scan$/.test(f)), 'depends-on reads as names');
      assert.ok(m.facts[1].some((f) => /Runbook Restart the library$/.test(f)), 'the runbook reads as its name');
      assert.ok(!m.all.includes('[['), 'no link brackets anywhere a person reads');
      assert.ok(m.facts.every((rows) => rows.every((f) => !/^Kind /.test(f))), 'what agrees (kind, address, the rest) is not repeated');
      assert.equal(m.btn, 'Keep chosen', 'one button, plain words');
      const colors = await ev(`(() => {
        const probe = document.createElement('div');
        probe.style.cssText = 'position:absolute;left:-99px;background:var(--accent);';
        document.body.appendChild(probe);
        const want = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return { got: getComputedStyle(document.querySelector('.sys-conflict-head input')).accentColor, want };
      })()`);
      assert.equal(colors.got, colors.want, `the choice ticks in the app's accent, never the browser's blue (${colors.got})`);
      ws.close();
    } finally {
      child.kill();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
