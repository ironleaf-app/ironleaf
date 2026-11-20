// node --test tests/bills-conflict-card.test.mjs — the two-PC card on a bill's page (t20 break job,
// 8 Nov 2026: the bills job added the card but never drew it). A bill changed on two PCs keeps each
// version in Me/Finance/Bills.md; its page shows every version with the facts where they differ, one
// choice, one Keep chosen button. Proven with a made-up conflicted list: the real card drawn in the
// headless shell at the sizes, the choice calling once, and the choice written once so the list
// holds one version after.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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

const work = mkdtempSync(path.join(tmpdir(), 'nv-bills-card-'));
let B;
let M;
let cardJs;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const src = (p) => JSON.stringify(path.join(root, p));
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * as B from ${src('src/shared/bills-table.ts')};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 's.mjs'), format: 'esm' }, logLevel: 'silent' });
  const main = path.join(work, 'main.ts');
  writeFileSync(main, [`export { resolveBillsConflictAt } from ${src('src/main/bills-tables.ts')};`, `export { VaultIndex } from ${src('src/main/indexer.ts')};`, ''].join('\n'));
  await build({ input: main, platform: 'node', external: ['yaml', 'electron', /^node:/], output: { file: path.join(work, 'm.mjs'), format: 'esm' }, logLevel: 'silent' });
  try {
    symlinkSync(path.join(root, 'node_modules'), path.join(work, 'node_modules'), 'junction');
  } catch {}
  ({ B } = await import(pathToFileURL(path.join(work, 's.mjs')).href));
  M = await import(pathToFileURL(path.join(work, 'm.mjs')).href);
  // The real card for the shell: the bill page's own component with its real section, driven through
  // React, with the window's save call stubbed. Stylesheets ride in the page, so css imports stub out.
  const cardEntry = path.join(work, 'card.tsx');
  writeFileSync(
    cardEntry,
    [
      `import { createElement } from 'react';`,
      `import { createRoot } from 'react-dom/client';`,
      `import { BillsConflictCard } from ${src('src/renderer/src/views/modules/RecordModulePage.tsx')};`,
      `const w = window as unknown as Record<string, any>;`,
      `createRoot(document.getElementById('root')!).render(createElement(BillsConflictCard, { conflict: w.__conflict, canEdit: w.__canEdit !== false }));`,
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

// A made-up list as OneDrive leaves it: this PC's Harbour Internet row, then the office PC's changed
// row merged under its own heading (amount, due day and autopay differ; the rest agrees).
const MINE = `---
type: bills-table
table: bills
version: 1
---
# Bills

One line per bill. You can read this file; the Money page reads it too.

| Name | Kind | Amount | Cycle | Due | Category | Account | Project | Autopay | Status | Paid | Note file |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Harbour Internet | Bill | 89.00 | Monthly | 2026-11-12 | Phone and internet | Everyday |  | No | Active |  |  |
| Streamly | Subscription | 16.99 | Monthly | 2026-11-10 | Subscriptions |  |  | Yes | Active |  |  |
`;
const THEIRS = MINE.replace('| Harbour Internet | Bill | 89.00 | Monthly | 2026-11-12 | Phone and internet | Everyday |  | No | Active |  |  |', '| Harbour Internet | Bill | 94.50 | Monthly | 2026-11-15 | Phone and internet | Everyday | [[Harbourview Fete]] | Yes | Active |  |  |');
const merged = () => B.mergeBillsTables(MINE, THEIRS, 'OFFICE-PC', '8 Nov 2026').text;
/** The disagreement as the Money page hands it to the bill's page (src/main/record-modules.ts finance()). */
const conflictOf = () => {
  const doc = B.readBillsTable(merged());
  const kept = doc.rows.find((r) => B.billNameKey(r.name) === B.billNameKey('Harbour Internet'));
  const others = doc.conflicts[B.billNameKey('Harbour Internet')] ?? [];
  return { name: kept.name, path: 'Me/Finance/Bills.md#harbour-internet', kept: kept.cells, keptNote: kept.note, others: others.map((x) => ({ name: x.name, cells: x.cells, note: x.note })) };
};

// The window's stylesheets in the order it loads them (main.tsx), so the cascade is the window's.
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
window.nv = { recmod: { billsResolveConflict: (name, keep) => { window.__calls.push([name, keep]); return Promise.resolve({ words: 'Kept.', path: 'Me/Finance/Bills.md' }); } } };</script>
<script type="module">${inline}</script>
</body></html>
`;
}

test('a bill changed on two PCs hands its page each version to choose', () => {
  const doc = B.readBillsTable(merged());
  assert.deepEqual(doc.dupes, ['Harbour Internet'], 'the changed bill is the one disagreement');
  assert.equal(doc.conflicts[B.billNameKey('Harbour Internet')].length, 1, 'their version kept beside the shown one');
  const c = conflictOf();
  assert.equal(c.kept.amount, '89.00', 'the shown version is this PC’s');
  assert.equal(c.others[0].cells.amount, '94.50', 'theirs is there to choose');
  assert.equal(c.others[0].cells.due, '2026-11-15');
  assert.equal(c.others[0].cells.project, '[[Harbourview Fete]]', 'their project rides along raw; the card reads it plain');
});

test('choosing writes the list once, holding one version after', async () => {
  const text = merged();
  const rel = 'Me/Finance/Bills.md';
  const fake = (onWrite) => {
    const index = new M.VaultIndex();
    index.set(rel, text, 0, text.length);
    return {
      root: work,
      index,
      writeNote: async (p, t) => onWrite(p, t),
      requireCreate: async () => {},
      areas: async () => [{ id: 'me', folder: 'Me' }],
      today: () => new Date(2026, 10, 8),
      options: async () => ({ version: 1, modules: {} }),
      setFinanceSettings: async () => {},
      billNotes: async () => [],
      newNote: async () => '',
    };
  };
  const writes = [];
  const at = await M.resolveBillsConflictAt(fake((p, t) => writes.push([p, t])), 'Harbour Internet', 1);
  assert.equal(writes.length, 1, 'the choice writes once');
  assert.equal(writes[0][0], rel, 'to the list itself');
  const after = B.readBillsTable(writes[0][1]);
  assert.deepEqual(after.dupes, [], 'no disagreement left');
  assert.equal(after.rows.find((r) => B.billNameKey(r.name) === B.billNameKey('Harbour Internet')).cells.amount, '94.50', 'their version is the bill’s now');
  assert.ok(at.startsWith(rel), 'the bill’s page stays the answer');
  const writes2 = [];
  await assert.rejects(() => M.resolveBillsConflictAt(fake((p, t) => writes2.push([p, t])), 'Harbour Internet', 5), /Choose one of the versions/, 'a choice past the versions refuses');
  assert.equal(writes2.length, 0, 'refusing writes nothing');
});

test('the real card draws both versions, the choice calls once, and nothing runs past its room', async () => {
  assert.ok(existsSync(SHELL), `no headless Chromium (HEADLESS_SHELL): ${SHELL}`);
  const WebSocket = require('ws');
  const css = stylesheets();
  const dir = mkdtempSync(path.join(tmpdir(), 'nv-bills-card-'));
  try {
    const page = path.join(dir, 'card.html');
    writeFileSync(page, harness(css, cardJs, conflictOf()));
    const locked = path.join(dir, 'locked.html');
    writeFileSync(locked, harness(css, cardJs, conflictOf(), false));
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
      // The sizes: a 3456 window, a laptop, and the small window.
      for (const [w, h] of [[3456, 1408], [1920, 1117], [1219, 709]]) {
        await open(w, h, page);
        const m = await ev(`(() => {
          const sec = document.querySelector('.p87-sec');
          const vers = [...document.querySelectorAll('.sys-conflict-ver')];
          const facts = vers.map((v) => [...v.querySelectorAll('.sys-conflict-facts li')].map((li) => li.innerText.replace(/\\n/g, ' ')));
          const card = document.querySelector('.p87-sec .card');
          const cb = card.getBoundingClientRect();
          const over = [...document.querySelectorAll('.sys-conflict-ver, .sys-conflict-facts li')].map((el) => ({ w: el.clientWidth, full: el.scrollWidth }));
          return {
            head: document.querySelector('.p87-sec .glabel').innerText.trim(),
            lead: sec.querySelector('.vsub').innerText,
            vers: vers.map((v) => v.querySelector('.sys-conflict-head').innerText.trim()),
            facts, btn: document.querySelector('.sys-actions .button').innerText.trim(),
            card: { left: cb.left, right: cb.right },
            over,
            all: sec.innerText,
            page: { clientW: document.documentElement.clientWidth, scrollW: document.documentElement.scrollWidth },
          };
        })()`);
        const where = `${w}x${h}`;
        assert.equal(m.head, 'Changed on two PCs', `${where}: the card says what happened`);
        assert.match(m.lead, /Harbour Internet was changed on two PCs/, `${where}: the lead names the bill in plain words`);
        assert.deepEqual(m.vers, ['Shown now', 'The other version'], `${where}: each version headed plainly`);
        assert.ok(m.facts[0].some((f) => /Amount 89\.00/.test(f)) && m.facts[1].some((f) => /Amount 94\.50/.test(f)), `${where}: the differing amounts show on each`);
        assert.ok(m.facts[0].some((f) => /Due 2026-11-12/.test(f)) && m.facts[1].some((f) => /Due 2026-11-15/.test(f)), `${where}: the differing due days show on each`);
        assert.ok(m.facts[1].some((f) => /Project Harbourview Fete$/.test(f)), `${where}: their project reads as its name`);
        assert.ok(!m.all.includes('[['), `${where}: no link brackets anywhere a person reads`);
        assert.ok(m.facts.every((rows) => rows.every((f) => !/^Kind /.test(f))), `${where}: what agrees (kind, cycle, the rest) is not repeated`);
        assert.equal(m.btn, 'Keep chosen', `${where}: one button, plain words`);
        assert.ok(m.page.scrollW <= m.page.clientW + 1, `${where}: nothing runs past the page sideways (${m.page.scrollW} in ${m.page.clientW})`);
        for (const o of m.over) assert.ok(o.full <= o.w + 1, `${where}: every version and fact fits its room (${o.full} in ${o.w})`);
      }
      // The choice works: the other version picked, Keep chosen calls once with it.
      await open(1219, 709, page);
      await ev(`[...document.querySelectorAll('.sys-conflict-head input')][1].click()`);
      assert.equal(await ev(`document.querySelectorAll('.sys-conflict-ver.is-on').length`), 1, 'one version chosen');
      assert.equal(await ev(`[...document.querySelectorAll('.sys-conflict-ver')].findIndex((v) => v.classList.contains('is-on'))`), 1, 'the other version chosen');
      await ev(`document.querySelector('.sys-actions .button').click()`);
      let calls = null;
      for (let i = 0; i < 40 && (!calls || !calls.length); i++) {
        await sleep(100);
        calls = await ev(`window.__calls`);
      }
      assert.deepEqual(calls, [['Harbour Internet', 1]], 'Keep chosen saves the picked version, once');
      const colors = await ev(`(() => {
        const probe = document.createElement('div');
        probe.style.cssText = 'position:absolute;left:-99px;background:var(--accent);';
        document.body.appendChild(probe);
        const want = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return { got: getComputedStyle(document.querySelector('.sys-conflict-head input')).accentColor, want };
      })()`);
      assert.equal(colors.got, colors.want, `the choice ticks in the app's accent, never the browser's blue (${colors.got})`);
      // Read-only: nothing to pick, nothing to keep.
      await open(1219, 709, locked);
      assert.equal(await ev(`[...document.querySelectorAll('.sys-conflict-head input')].filter((r) => r.disabled).length`), 2, 'read-only: no version can be picked');
      assert.equal(await ev(`document.querySelector('.sys-actions .button').disabled`), true, 'read-only: nothing can be kept');
      ws.close();
    } finally {
      child.kill();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
