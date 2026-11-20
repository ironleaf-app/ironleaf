// node --test tests/vault-editable-shell.test.mjs — everything shown is editable, proven with the
// real renderer in the headless shell and a real test vault (p10-vault-editable, 4 Nov 2026). The
// window's real stylesheets in the window's order; the real Markdown renderer (renderMarkdown)
// bundled for the page; the real cell mapping and field (lib/readingTables.ts, the same code
// ReadingView calls); a real vault folder holding a made-up project note. In the shell: the note
// draws, every body cell maps to the source cell it shows (the headings map to nothing), a
// double-clicked cell opens the kit's field with its words as written, Enter writes it to the vault
// file, and the note drawn again plus the project hub and the records peek all show the new words
// at once. Esc puts the cell back with nothing written. A cell holding a link carries a pencil
// (round 2): the pencil opens the field with the words as written, a click on the link itself opens
// nothing here. Nothing runs past its room at a user's 1219x709 or at 1600x1000. The peek's React
// fields cannot run without the window, so the peek below is faithful markup (the same classes
// Peek.tsx renders) for the fit check only; the peek's writes are proven in
// tests/vault-editable.test.mjs and the reviewer takes real-app pictures.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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

const P = 'Projects/Harbourview Fete/Harbourview Fete.md';
const NOTE = `---
type: project
status: active
health: on track
progress: 40
owner: Alex Chen
due: 2026-12-05
---

# Harbourview Fete

## Summary

A stalls-and-music day on the oval.

## Workstreams

| Workstream | Owner | Status | Progress | Next step |
| --- | --- | --- | --- | --- |
| Stalls | Alex Chen | In progress | 60% | Confirm the cake stall map |
| Music | Sam Lee | Not started | 10 | Book the PA hire |

## What's next

- [ ] Confirm the cake stall map — Alex Chen · by 20 Nov 2026

## Key dates

| Date | Milestone | Status |
| --- | --- | --- |
| 2026-11-20 | Stall map locked in | next |
| 2026-12-05 | Fete day |  |
`;

// A cell holding a link, beside a plain one (round 2: the pencil).
const LINKED = `# People

| Name | Role |
| --- | --- |
| [[Alex Chen]] | Stalls |
| Sam Lee | Music |
`;

// The window's stylesheets in the order it loads them (main.tsx), so the cascade is the window's.
function stylesheets() {
  const order = [...read('src/renderer/src/main.tsx').matchAll(/import '\.\/(styles\.css|styles\/[^']+\.css)';/g)].map((m) => m[1]);
  assert.ok(order.length > 10 && order[0] === 'styles.css', `${order.length} stylesheets in the window's order`);
  return order.map((f) => `/* ${f} */\n${read(`src/renderer/src/${f}`)}`).join('\n');
}

// The peek's workstream facts as Peek.tsx draws them once editable: Who as the
// page's own Inline (pencil, double-click to change), Status as its Choice
// pill, Progress as its slider, Next step as Inline. Faithful markup for fit.
const PEEK_AFTER = `
<aside class="peek rec-kinds" role="complementary" aria-label="Workstream: Stalls">
<div class="peek-scroll">
<div class="peek-head">
<span class="peek-kind kind-workstream">Workstream</span>
<h2 class="peek-title">Stalls</h2>
</div>
<dl class="peek-facts">
<div class="peek-fact"><dt>Who</dt><dd><span class="pj-ed has-pencil" role="button" tabindex="0" title="Double-click or E to change the who">Alex Chen<span class="rec-pencil" aria-hidden="true">✎</span></span></dd></div>
<div class="peek-fact"><dt>Status</dt><dd><button type="button" class="pj-pill tone-warn ly-choice">In progress ▾</button></dd></div>
<div class="peek-fact"><dt>Progress</dt><dd><span class="ly-pct is-edit tone-accent"><span class="ly-pct-slider" role="slider" tabindex="0" aria-label="Progress"><span class="ly-bar"><span style="width:60%"></span></span></span><span class="ly-pct-figure">60%</span></span></dd></div>
<div class="peek-fact"><dt>Next step</dt><dd><span class="pj-ed has-pencil" role="button" tabindex="0" title="Double-click or E to change the next step">Confirm the cake stall map<span class="rec-pencil" aria-hidden="true">✎</span></span></dd></div>
</dl>
</div>
</aside>`;

function harness(css, bundle, note) {
  return `<!doctype html>
<html lang="en-AU">
<head><meta charset="utf-8"><style>${css}</style></head>
<body>
<div class="app" data-platform="linux"><div class="ribbon"></div>
<main class="main"><div class="reading"><div class="reading-page"><div class="markdown reading-body" id="body"></div></div></div></main>
${PEEK_AFTER}
</div>
<script>window.__note = ${JSON.stringify(note)};</script>
<script>${bundle}</script>
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

test('editable where shown: real render, real field, real vault file, every view at once', async () => {
  assert.ok(existsSync(SHELL), `no headless Chromium (HEADLESS_SHELL): ${SHELL}`);
  const WebSocket = require('ws');
  const dir = mkdtempSync(path.join(tmpdir(), 'nv-editable-shell-'));
  const work = mkdtempSync(path.join(tmpdir(), 'nv-editable-shell-build-'));
  const childHolder = { child: null };
  try {
    // The real test vault: the made-up project note as a file.
    const file = path.join(dir, P);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, NOTE);

    // The node side: the shared model for the every-view-agrees checks.
    const { build: rolldown } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
    mkdirSync(path.join(work, 'node_modules'), { recursive: true });
    try { symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction'); } catch {}
    const nodeEntry = path.join(work, 'node-entry.ts');
    writeFileSync(
      nodeEntry,
      [
        `export { parseProject } from ${JSON.stringify(path.join(root, 'src/shared/project-file.ts'))};`,
        `export { workstreams } from ${JSON.stringify(path.join(root, 'src/shared/project-hub.ts'))};`,
        `export { buildRecordModel, peekOf } from ${JSON.stringify(path.join(root, 'src/shared/records.ts'))};`,
        `export { setTableLineCell } from ${JSON.stringify(path.join(root, 'src/shared/layouts.ts'))};`,
        '',
      ].join('\n'),
    );
    await rolldown({ input: nodeEntry, platform: 'node', external: ['yaml', 'electron'], output: { file: path.join(work, 'node-shared.mjs'), format: 'esm' }, logLevel: 'silent' });
    const S = await import(pathToFileURL(path.join(work, 'node-shared.mjs')).href);

    // The page side: the real renderer plus the real cell code, bundled for the shell.
    const storeStub = path.join(work, 'store-stub.ts');
    writeFileSync(storeStub, 'export const getState = () => ({ notes: [], files: [] });\n');
    const pageEntry = path.join(work, 'page-entry.ts');
    writeFileSync(
      pageEntry,
      [
        `export { renderMarkdown } from ${JSON.stringify(path.join(root, 'src/renderer/src/lib/markdownRender.ts'))};`,
        `export { editableCells, markEditableCells, editTableCell, openTableCell, resetTableCell, pencilCells } from ${JSON.stringify(path.join(root, 'src/renderer/src/lib/readingTables.ts'))};`,
        `export { tableLineCell, setTableLineCell } from ${JSON.stringify(path.join(root, 'src/shared/layouts.ts'))};`,
        '',
      ].join('\n'),
    );
    const { build: viteBuild } = await import('vite');
    await viteBuild({
      root: work,
      logLevel: 'silent',
      resolve: { alias: [{ find: '../state/store', replacement: storeStub }] },
      build: { lib: { entry: pageEntry, formats: ['iife'], name: 'NV', fileName: 'page' }, outDir: path.join(work, 'page'), emptyOutDir: true, minify: false },
    });
    const built = readdirSync(path.join(work, 'page')).find((f) => f.endsWith('.js'));
    assert.ok(built, 'the page bundle built');
    const bundle = readFileSync(path.join(work, 'page', built), 'utf8');
    assert.ok(bundle.includes('data-line'), 'the bundle holds the real renderer');

    const html = harness(stylesheets(), bundle, NOTE);
    const page = path.join(dir, 'page.html');
    writeFileSync(page, html);

    const port = await freePort();
    const child = spawn(SHELL, ['--headless', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${port}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
    childHolder.child = child;
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
    const ev = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r?.exceptionDetails) throw new Error(`in the shell: ${r.exceptionDetails.text ?? JSON.stringify(r.exceptionDetails).slice(0, 400)}`);
      return r?.result?.value;
    };
    await send('Page.enable');
    await send('Runtime.enable');

    let savedCell = null;
    for (const [width, height] of [[1219, 709], [1600, 1000]]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      await send('Page.navigate', { url: pathToFileURL(page).href });
      let ready = false;
      for (let i = 0; i < 60 && !ready; i++) {
        await sleep(150);
        try {
          ready = await ev(`!!(window.NV && document.querySelector('.reading-body'))`);
        } catch {}
      }
      assert.ok(ready, `the page drew at ${width}x${height}`);

      // The real renderer draws the real vault note; the real marking offers the field on every body cell.
      const drawn = await ev(`(() => {
        const body = document.querySelector('.reading-body');
        body.innerHTML = NV.renderMarkdown(window.__note, { from: ${JSON.stringify(P)}, interactive: true });
        const lines = window.__note.split('\\n');
        NV.markEditableCells(body, (line, col) => NV.tableLineCell(lines[line] ?? '', col));
        const tds = [...body.querySelectorAll('td[data-editable]')];
        const ths = [...body.querySelectorAll('th[data-editable]')];
        const landed = tds.map((td) => NV.tableLineCell(lines[Number(td.dataset.line)] ?? '', Number(td.dataset.col)));
        const shown = tds.map((td) => td.textContent.trim());
        return {
          tables: body.querySelectorAll('table').length,
          editable: tds.length,
          headingsMarked: ths.length,
          checkbox: !!body.querySelector('input.task-checkbox'),
          landed,
          shown,
        };
      })()`);
      assert.equal(drawn.tables, 2, `two tables drew at ${width}x${height}`);
      assert.equal(drawn.editable, 16, `every body cell offers the field at ${width}x${height}`);
      assert.equal(drawn.headingsMarked, 0, `no heading offers the field at ${width}x${height}`);
      assert.ok(drawn.checkbox, `the tick box drew at ${width}x${height}`);
      // Each marked cell lands on the source cell it shows (the mapping the save writes through).
      for (let i = 0; i < drawn.landed.length; i++) assert.equal(drawn.landed[i], drawn.shown[i], `cell ${i} lands where it shows at ${width}x${height}`);

      // A double-clicked cell opens the kit's field with its words as written; Enter writes it through.
      const field = await ev(`(() => {
        const td = [...document.querySelectorAll('td[data-editable]')].find((x) => x.textContent.trim() === 'In progress');
        const before = { line: td.dataset.line, col: td.dataset.col };
        window.__saved = null;
        const lines = window.__note.split('\\n');
        const p = NV.editTableCell(td, (line, col) => NV.tableLineCell(lines[line] ?? '', col), (line, col, value) => {
          window.__saved = { line, col, value };
          return true;
        });
        const input = td.querySelector('input.nv-cell-input');
        const opened = { value: input ? input.value : null, kit: input ? input.classList.contains('input') : false };
        input.value = 'At risk';
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        return p.then(() => ({ before, opened, saved: window.__saved }));
      })()`);
      assert.equal(field.opened.value, 'In progress', `the field opens with the words as written at ${width}x${height}`);
      assert.ok(field.opened.kit, `the field is the kit's at ${width}x${height}`);
      assert.deepEqual(field.saved, { line: Number(field.before.line), col: Number(field.before.col), value: 'At risk' }, `Enter writes through at ${width}x${height}`);
      savedCell = field.saved;

      // Esc puts a cell back with nothing written.
      const esc = await ev(`(() => {
        const td = [...document.querySelectorAll('td[data-editable]')].find((x) => x.textContent.trim() === 'Not started');
        const lines = window.__note.split('\\n');
        let saved = false;
        const p = NV.editTableCell(td, (line, col) => NV.tableLineCell(lines[line] ?? '', col), () => { saved = true; return true; });
        const input = td.querySelector('input.nv-cell-input');
        input.value = 'Changed by mistake';
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        return p.then(() => ({ saved, back: td.textContent.trim() }));
      })()`);
      assert.equal(esc.saved, false, `Esc writes nothing at ${width}x${height}`);
      assert.equal(esc.back, 'Not started', `Esc puts the cell back at ${width}x${height}`);

      // A cell holding a link carries a pencil; a plain one carries none. The pencil opens the field with the
      // words as written (links and all); a click on the link itself opens no field here (in the window it opens
      // the link, as before).
      const pencil = await ev(`(() => {
        const body = document.querySelector('.reading-body');
        body.innerHTML = NV.renderMarkdown(${JSON.stringify(LINKED)}, { from: 'Notes/People.md', interactive: true });
        const lines = ${JSON.stringify(LINKED)}.split('\\n');
        const read = (line, col) => NV.tableLineCell(lines[line] ?? '', col);
        NV.markEditableCells(body, read);
        NV.pencilCells(body);
        const linked = [...body.querySelectorAll('td[data-editable]')].find((x) => x.textContent.includes('Alex Chen'));
        const plain = [...body.querySelectorAll('td[data-editable]')].find((x) => x.textContent.trim() === 'Music');
        const has = { linked: !!linked.querySelector(':scope > .nv-cell-edit'), plain: !!plain.querySelector('.nv-cell-edit') };
        // The page reads pencil clicks where it reads all clicks (ReadingView's handler, by the button's class):
        // one listener on the page, the pencil opens the field, the link opens nothing here.
        let done = null;
        body.addEventListener('click', (e) => {
          const pc = e.target.closest('.nv-cell-edit');
          if (!pc) return;
          const t = pc.closest('td[data-editable]');
          if (t) done = NV.editTableCell(t, read, () => true);
        });
        linked.querySelector(':scope > .nv-cell-edit').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        const input = linked.querySelector('input.nv-cell-input');
        const opened = input ? input.value : null;
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        return done.then(() => {
          linked.querySelector('a').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
          return { has, opened, linkOpensField: !!linked.querySelector('input.nv-cell-input') };
        });
      })()`);
      assert.equal(pencil.has.linked, true, `the link cell carries a pencil at ${width}x${height}`);
      assert.equal(pencil.has.plain, false, `a plain cell carries no pencil at ${width}x${height}`);
      assert.equal(pencil.opened, '[[Alex Chen]]', `the pencil opens the field with the words as written at ${width}x${height}`);
      assert.equal(pencil.linkOpensField, false, `a click on the link opens no field at ${width}x${height}`);

      // Nothing runs past its room: the reading page, the open field's cell, and the peek's editable facts.
      const fit = await ev(`(() => {
        const doc = document.documentElement;
        const peek = document.querySelector('.peek');
        const facts = [...document.querySelectorAll('.peek-fact dd')].map((dd) => ({ sw: dd.scrollWidth, cw: dd.clientWidth }));
        return { sw: doc.scrollWidth, cw: doc.clientWidth, peek: peek ? { sw: peek.scrollWidth, cw: peek.clientWidth } : null, facts };
      })()`);
      assert.ok(fit.sw - fit.cw <= 1, `the page runs ${fit.sw - fit.cw}px past its room at ${width}x${height}`);
      if (fit.peek) assert.ok(fit.peek.sw - fit.peek.cw <= 1, `the peek runs ${fit.peek.sw - fit.peek.cw}px past its room at ${width}x${height}`);
      fit.facts.forEach((f, i) => assert.ok(f.sw - f.cw <= 1, `peek fact ${i} runs ${f.sw - f.cw}px past its room at ${width}x${height}`));
    }

    // The save lands in the vault file; the note drawn again, the hub and the peek all show it at once.
    assert.ok(savedCell, 'the shell saved a cell');
    const lines = readFileSync(file, 'utf8').split('\n');
    lines[savedCell.line] = S.setTableLineCell(lines[savedCell.line], savedCell.col, savedCell.value);
    writeFileSync(file, lines.join('\n'));
    const after = readFileSync(file, 'utf8');
    assert.match(after, /\| Stalls \| Alex Chen \| At risk \| 60% \|/);
    assert.equal(S.workstreams(S.parseProject(after, P)).find((w) => w.name === 'Stalls')?.status, 'At risk');
    const model = S.buildRecordModel({ notes: [{ path: P, title: 'Harbourview Fete', content: after, props: { type: 'project' } }], resolve: () => null, today: '2026-11-04', me: 'Alex Chen' });
    assert.equal(S.peekOf(model, { id: `workstream:${P}#stalls` })?.record.facts.find((f) => f.key === 'status')?.value, 'At risk');

    ws.close();
  } finally {
    childHolder.child?.kill('SIGKILL');
    rmSync(dir, { recursive: true, force: true });
    rmSync(work, { recursive: true, force: true });
  }
});
