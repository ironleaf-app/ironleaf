// SPDX-License-Identifier: AGPL-3.0-or-later
// Designed slides saved as PowerPoint (22 Nov 2026, Design studio phase 2): a deck laid out in the print page is read
// back (src/shared/design-slides.ts), each slide pictured without its words and the words laid on top as text boxes
// (src/main/design-export/pptx.ts). The file must hold every word as text, each box must hold what the page drew (a
// squeezed figure never becomes a column one letter wide), and it must open where people open decks: LibreOffice
// stands in for PowerPoint here, turning the file back into pages.

import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.join(import.meta.dirname, '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-pptx-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SHELL = process.env.HEADLESS_SHELL || (process.env.HOME || '') + '/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell';
const has = (cmd) => {
  try {
    execFileSync('which', [cmd], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};
let D;
let browser;

before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/shared/design-doc.ts'))};\nexport * from ${JSON.stringify(path.join(root, 'src/shared/design-slides.ts'))};\nexport { designPptx } from ${JSON.stringify(path.join(root, 'src/main/design-export/pptx.ts'))};\n`);
  await build({ input: entry, platform: 'node', external: ['pptxgenjs'], output: { file: path.join(work, 'dx.mjs'), format: 'esm' }, logLevel: 'silent' });
  const file = path.join(work, 'dx.mjs');
  writeFileSync(file, readFileSync(file, 'utf8').replace(/from ['"]pptxgenjs['"]/g, `from ${JSON.stringify(pathToFileURL(require.resolve('pptxgenjs')).href)}`));
  D = await import(pathToFileURL(file).href);
});
after(() => {
  browser?.close();
  rmSync(work, { recursive: true, force: true });
});

const KIT = { name: 'Harbour Pine', logos: {}, colours: [{ name: 'Pine', hex: '#123f36', use: 'Headings' }, { name: 'Crust', hex: '#d9a441' }], fonts: [{ name: 'Figtree', use: 'Headings' }] };

const DECK = `<style>.big{font-family:var(--font-head);font-size:var(--fs-9);line-height:1;color:var(--accent-strong);margin:0}</style>
<section class="page" style="background:var(--accent);color:var(--on-accent);padding:var(--sp-7)"><p class="kicker" style="color:var(--on-accent)">Report · For the board</p><h1 class="display" style="color:var(--on-accent)">Q3 marketing review</h1><p class="lead" style="color:var(--on-accent)">Our best quarter for <b>online</b> orders.</p></section>
<section class="page" style="padding:var(--sp-6) var(--sp-7)"><p class="kicker">Channels</p><h2 style="font-size:var(--fs-6);margin:0 0 var(--sp-5)">Loyalty pushes win orders at $0.39 each</h2>
<div class="grid"><div class="span-5"><p class="big">$0.39</p><p>Cost per order, loyalty app pushes</p></div><div class="span-7"><ul><li>Instagram cost $4.19 an order</li><li>Local print cost $11.05 an order</li></ul></div></div>
<div class="figures" style="width:20mm;display:grid;grid-template-columns:repeat(4,1fr)"><div><b>$412k</b><span>Revenue</span></div><div><b>38%</b><span>Online</span></div><div><b>6,850</b><span>Members</span></div><div><b>4.8</b><span>Rating</span></div></div>
<footer class="nv-foot"><span>Harbour Pine · Q3 review</span><nv-page-number></nv-page-number></footer></section>`;

test('the reader keeps the words as text and hides them from the picture; the office theme uses fonts Office has', { skip: !existsSync(SHELL) && 'no headless Chromium' }, async () => {
  const office = D.officeTheme(D.designTheme(KIT));
  assert.ok(/^Arial/.test(office.head) && /^Arial/.test(office.body), `a web font becomes Arial (got ${office.head})`);
  assert.ok(/^"Georgia"|^Georgia/.test(D.officeTheme(D.designTheme({ ...KIT, fonts: [{ name: 'Georgia', use: 'Headings' }] })).head), 'a kit font Office has is kept');
  browser = await startBrowser();
  const kind = D.kindInfo('slides');
  const layout = D.readDesign(DECK);
  assert.ok(layout);
  const page = D.designPage({ fit: true, kind, theme: office, title: 'Q3 marketing review', layout, blocks: [], logos: {}, brandName: 'Harbour Pine', foot: 'Q3', keepAll: false, nonce: 'n0nce' });
  const file = path.join(work, 'deck.html');
  writeFileSync(file, page);
  const W = Math.ceil(kind.page.w * (96 / 25.4)) + 40;
  const H = Math.ceil(kind.page.h * (96 / 25.4)) + 4;
  await browser.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await browser.send('Page.navigate', { url: pathToFileURL(file).href });
  let report = null;
  for (let i = 0; i < 100 && !report; i++) {
    await sleep(100);
    report = await browser.ev('window.__report || null');
  }
  assert.ok(report, 'the deck laid out');
  const read = await browser.send('Runtime.evaluate', { expression: D.SLIDE_READ_JS, returnByValue: true });
  assert.ok(!read.result.exceptionDetails, `the reader runs (${JSON.stringify(read.result.exceptionDetails ?? '').slice(0, 300)})`);
  const pages = read.result.result.value;
  assert.equal(pages.length, 2, 'two slides read');
  const words = (p) => p.texts.map((t) => t.runs.map((r) => r.t).join('')).join(' | ');
  assert.match(words(pages[0]), /Q3 marketing review/, 'the title is a text box');
  assert.ok(pages[0].texts.some((t) => t.runs.some((r) => r.t.includes('Report · For the board') && r.up)), 'a kicker in CSS capitals keeps its words as written, marked for capitals');
  assert.ok(pages[0].texts.some((t) => t.runs.some((r) => r.t === 'online' && r.b)), 'a bold word stays bold');
  assert.match(words(pages[1]), /\$0\.39/, 'the hero number is a text box');
  assert.match(words(pages[1]), /Instagram cost \$4\.19 an order/, 'a list item is a text box');
  // A figure in a squeezed band: its box holds what the page drew, never a sliver.
  const fig = pages[1].texts.find((t) => t.runs.some((r) => r.t === '$412k'));
  assert.ok(fig, 'the squeezed figure is read');
  const painted = await browser.ev(`(() => { const b = [...document.querySelectorAll('.figures b')].find((e) => e.textContent === '$412k'); const r = document.createRange(); r.selectNodeContents(b); const q = r.getBoundingClientRect(); return q.width; })()`);
  assert.ok(fig.w >= painted - 1, `the figure's box (${Math.round(fig.w)} px) holds its painted words (${Math.round(painted)} px)`);
  const hidden = await browser.ev(`getComputedStyle(document.querySelector('h1')).webkitTextFillColor`);
  assert.match(hidden, /rgba\(0, 0, 0, 0\)|transparent/, 'the words are hidden from the background picture');
  const li = pages[1].texts.find((t) => t.runs.some((r) => r.t.startsWith('Instagram cost')));
  assert.equal(li?.list?.kind, 'bullet', 'a list item becomes a PowerPoint bullet (its marker is hidden with its words)');

  // Pictures at twice the pixels, then the file.
  await browser.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: false });
  await sleep(300);
  const slides = [];
  for (const p of pages) {
    const shot = await browser.send('Page.captureScreenshot', { format: 'png', clip: { x: p.x, y: p.y, width: p.w, height: p.h, scale: 1 }, captureBeyondViewport: true });
    slides.push({ page: p, background: Buffer.from(shot.result.data, 'base64') });
  }
  const pptx = await D.designPptx({ slides, title: 'Q3 marketing review', author: 'Harbour Pine' });
  const JSZip = require('jszip');
  const zip = await JSZip.loadAsync(pptx);
  const slideXml = await Promise.all(Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f)).sort().map((f) => zip.file(f).async('string')));
  assert.equal(slideXml.length, 2, 'two slides in the file');
  const all = slideXml.join(' ');
  for (const w of ['Q3 marketing review', '$0.39', 'Instagram cost $4.19 an order', '$412k', 'Harbour Pine · Q3 review']) assert.ok(all.includes(w.replace(/&/g, '&amp;')), `"${w}" is text in the file`);
  assert.ok(Object.keys(zip.files).some((f) => /^ppt\/media\/.+\.png$/.test(f)), 'each slide has its picture');
  assert.ok(/<a:buChar /.test(all), 'the list keeps its bullets');
  assert.ok(/cap="all"/.test(all) && !all.includes('en-x-caps'), 'the kicker is set in PowerPoint’s All caps');
  assert.ok(all.includes('Report · For the board'), 'with its words as written');
  const deck = path.join(work, 'deck.pptx');
  writeFileSync(deck, pptx);

  if (has('soffice')) {
    execFileSync('soffice', ['--headless', `-env:UserInstallation=${pathToFileURL(path.join(work, 'lo')).href}`, '--convert-to', 'pdf', '--outdir', work, deck], { stdio: 'ignore', timeout: 120_000 });
    const pdf = path.join(work, 'deck.pdf');
    assert.ok(existsSync(pdf), 'LibreOffice opens the deck');
    if (has('pdfinfo')) assert.match(execFileSync('pdfinfo', [pdf], { encoding: 'utf8' }), /Pages:\s+2/, 'and finds both slides');
  }
});

async function startBrowser() {
  const port = await new Promise((resolve) => {
    const s = net.createServer(() => {});
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
  const child = spawn(SHELL, ['--headless', '--no-sandbox', '--disable-gpu', '--allow-file-access-from-files', `--remote-debugging-port=${port}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
  let target;
  for (let i = 0; i < 100 && !target; i++) {
    await sleep(150);
    try {
      target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((x) => x.type === 'page');
    } catch {}
  }
  if (!target) throw new Error('the browser opened no page');
  const WebSocket = require('ws');
  const ws = new WebSocket(target.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 });
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  let id = 1;
  const pending = new Map();
  ws.onmessage = (m) => {
    const d = JSON.parse(typeof m.data === 'string' ? m.data : m.data.toString());
    if (d.id && pending.has(d.id)) {
      pending.get(d.id)(d);
      pending.delete(d.id);
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const i = id++;
      pending.set(i, resolve);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  const ev = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
  await send('Page.enable');
  return {
    send,
    ev,
    close: () => {
      try {
        ws.close();
      } catch {}
      try {
        child.kill('SIGKILL');
      } catch {}
    },
  };
}
