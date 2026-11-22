// node --test tests/design-doc.test.mjs — the Design studio's document (22 Nov 2026, src/shared/design-doc.ts): the
// brand kit as a theme of tokens, what the AI is told and sent (never a file address), its answer scrubbed, and the
// page the print window opens: run in headless Chromium with a hostile layout (scripts, handlers, a picture of a local
// file, url(), a style that breaks out of its element), which must come out clean, with the note's blocks and the logo
// placed, page numbers filled, an overflowing page and an empty one named, and the PDF's pages matching the report.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.join(import.meta.dirname, '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-design-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SHELL = process.env.HEADLESS_SHELL || (process.env.HOME || '') + '/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell';
let D;
let B;
let browser;

before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/shared/design-doc.ts'))};\nexport { brandContent } from ${JSON.stringify(path.join(root, 'src/shared/brand-document.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'dd.mjs'), format: 'esm' }, logLevel: 'silent' });
  D = await import(pathToFileURL(path.join(work, 'dd.mjs')).href);
  B = D;
});
after(() => {
  browser?.close();
  rmSync(work, { recursive: true, force: true });
});

const KIT = { name: 'Harbour Pine', logos: { primary: 'Logos/dark.svg', onDark: 'Logos/white.svg' }, colours: [{ name: 'Pine', hex: '#0f6b5c', use: 'Headings' }, { name: 'Sand', hex: '#e8dcc4' }, { name: 'Coral', hex: '#e4572e' }], fonts: [{ name: 'Figtree', use: 'Headings' }, { name: 'Source Sans 3', use: 'Body' }] };
const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);

test('the brand kit becomes a whole theme; no kit is quiet and neutral, never Ironleaf’s', () => {
  const t = D.designTheme(KIT);
  const tok = Object.fromEntries(t.tokens);
  assert.equal(tok.accent, '#0f6b5c');
  assert.equal(tok['on-accent'], '#ffffff');
  assert.ok(tok['brand-2'] && tok['brand-3'], 'the kit’s other colours are tokens');
  assert.match(tok['font-head'], /^"Figtree"/);
  assert.match(tok['font-body'], /^"Source Sans 3"/);
  assert.equal(tok['fs-1'], '10pt');
  assert.ok(t.branded);
  const plain = Object.fromEntries(D.designTheme(null).tokens);
  assert.equal(plain.accent, '#101820');
  assert.equal(D.designTheme(null).branded, false);
  // A pale accent can't carry headings on white: its strong step is darkened until it reads.
  const pale = Object.fromEntries(D.designTheme({ logos: {}, colours: [{ name: 'Wattle', hex: '#f6d13a' }], fonts: [] }).tokens);
  assert.ok(contrast(pale['accent-strong'], '#ffffff') >= 4.5, `accent-strong ${pale['accent-strong']} reads on white`);
  assert.equal(pale['on-accent'], '#101820', 'words on a pale accent are near-black');
  // A font name that could break out of the style sheet is never used.
  const odd = Object.fromEntries(D.designTheme({ logos: {}, colours: [], fonts: [{ name: 'X";}body{display:none' }] }).tokens);
  assert.ok(!odd['font-head'].includes('display:none'));
});

test('the AI is sent the note’s blocks by number, never a file address', () => {
  const kind = D.kindInfo('one-pager');
  const content = { title: 'Q3 plan', label: 'Note', sub: ['Ops'], figures: [{ value: '$42k', label: 'budget' }], people: [], blocks: ['<h2 class="blk">Why</h2>', '<p>We open <b>three</b> sites.</p>', '<figure><img src="file:///home/sam/Vault/Photos/site.png" alt="Site"></figure>', '<p><a href="file:///home/sam/Vault/Plan.pdf">the plan</a></p>'], confidential: true, foot: 'Ops team' };
  const ask = D.designAsk(kind, content, 'for the board');
  assert.ok(!ask.includes('file:'), 'no file address');
  assert.ok(!ask.includes('/home/sam'), 'no path on the PC');
  assert.match(ask, /<nv-block ref="b1"><h2/);
  assert.match(ask, /<nv-block ref="b3"><figure><img src="\(picture\)"/);
  assert.match(ask, /What the person asked for: for the board/);
  assert.match(ask, /\$42k \(budget\)/);
  assert.match(ask, /confidential/i);
  const sys = D.designSystem(kind, D.designTheme(KIT), { logo: true, brandName: 'Harbour Pine' });
  assert.match(sys, /exactly 1 page/);
  assert.match(sys, /210 × 297 mm/);
  assert.match(sys, /never invent/);
  const report = D.designSystem(D.kindInfo('report'), D.designTheme(null), { logo: false, brandName: '' });
  assert.match(report, /Place every single block exactly once/);
  assert.match(report, /one section class="flow" \(only one\) holding every block in order/);
  assert.match(report, /There is no logo/);
  assert.match(D.designSystem(D.kindInfo('slides'), D.designTheme(null), { logo: false, brandName: '' }), /297 × 167 mm/);
  // A long note is cut at the cap, and the AI is told so.
  const long = D.designAsk(kind, { ...content, blocks: Array.from({ length: 400 }, (_, i) => `<p>${'word '.repeat(60)}${i}</p>`) }, '');
  assert.ok(long.length < D.MAX_BLOCK_CHARS + 4000);
  assert.match(long, /blocks b\d+ to b400 are left out of this list/);
  assert.equal(D.blocksShown({ ...content, blocks: Array.from({ length: 400 }, (_, i) => `<p>${'word '.repeat(60)}${i}</p>`) }), (long.match(/<nv-block ref="b\d+">/g) || []).length);
});

test('the AI’s answer is scrubbed of everything that runs or reaches out', () => {
  const answer = 'Here is your design:\n```html\n<style>@import url(https://evil.example/x.css);@font-face{font-family:X;src:url(file:///etc/passwd)}.a{background:url("file:///home/sam/secret.png");fill:url(#g);position:fixed}</style>\n<section class="page" onclick="steal()"><script>alert(1)</script><img src="file:///etc/passwd"><a href="https://evil.example">x</a><iframe src="https://evil.example"></iframe><div style="background-image:url(https://evil.example/p.png)">Hi</div><svg><use href="#x"/><foreignObject><div>x</div></foreignObject></svg></section>\n```\nEnjoy!';
  const html = D.readDesign(answer);
  assert.ok(html, 'a layout came out');
  for (const bad of ['<script', 'alert(1)', 'onclick', '<img', 'href=', '<iframe', 'evil.example', 'file:', '@import', '@font-face', 'position:fixed', '<use', 'foreignObject', 'Enjoy']) assert.ok(!html.includes(bad), `no ${bad}`);
  assert.ok(html.includes('url(#g)'), 'a reference to its own gradient stays');
  assert.ok(html.startsWith('<style>') && html.endsWith('</section>'));
  assert.equal(D.readDesign('I can’t design this, sorry.'), null);
  assert.equal(D.readDesign('<style>.a{}</style>'), null, 'no section, no layout');
  assert.ok(D.saysFinished(' Finished. '));
  assert.ok(!D.saysFinished('<section>finished</section>'));
});

test('the page holds the layout as data: nothing the AI wrote can close it and run', () => {
  const page = D.designPage({ kind: D.kindInfo('report'), theme: D.designTheme(KIT), title: 'Q3 </title><script>x()</script>', layout: '<section class="page">a</section></script><script>alert(1)</script>', blocks: ['<p>b</p>'], logos: {}, brandName: '', foot: '', keepAll: true, nonce: 'abc123' });
  assert.match(page, /Content-Security-Policy" content="default-src 'none'; img-src file: data:; font-src file: data:; style-src 'unsafe-inline'; script-src 'nonce-abc123'/);
  assert.equal(page.split('<script').length - 1, 2, 'two script elements: the data and the page’s own');
  assert.ok(!page.includes('<script>alert(1)'), 'the layout’s script tag is escaped inside the data');
  assert.ok(!page.includes('</title><script>x()'), 'the title is escaped');
  // A flow page is as wide as a designed page (its side margins are padding): a narrower printed width made Chromium
  // shrink every page of the document to 85%.
  assert.match(page, /@page flow\{size:210mm 297mm;margin:16mm 0 18mm;/);
  assert.match(page, /@media print\{section\.flow\{width:auto;padding:0 16mm\}\}/);
});

// ── In headless Chromium ─────────────────────────────────────────────────────────────────────────────────────────────

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
  const ws = new WebSocket(target.webSocketDebuggerUrl);
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
  await send('Emulation.setDeviceMetricsOverride', { width: 840, height: 1130, deviceScaleFactor: 1, mobile: false });
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

test('in Chromium: a hostile layout comes out clean, the blocks and logo are placed, and the pages are measured', { skip: !existsSync(SHELL) && 'no headless Chromium' }, async () => {
  browser = await startBrowser();
  const logo = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40"><rect width="100" height="40" fill="#fff"/></svg>').toString('base64');
  const darkLogo = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40"><rect width="100" height="40" fill="#123"/></svg>').toString('base64');
  writeFileSync(path.join(work, 'secret.txt'), 'secret');
  const raw = `<style>.cover h1{font-size:var(--fs-8)} #g{opacity:1} .x{background:url(file://${work}/secret.txt)}</style>
<section class="page cover" style="background:var(--accent);color:var(--on-accent);padding:var(--sp-7)"><nv-logo role="onDark" style="height:14mm"></nv-logo><h1>Q3 plan</h1>
<svg viewBox="0 0 100 20" width="100" height="20"><defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></defs><rect width="100" height="20" fill="url(#g)"/></svg>
<div class="x" onmouseover="alert(1)">cover words</div><footer class="nv-foot"><span>Q3</span><nv-page-number></nv-page-number></footer></section>
<section class="page" style="padding:var(--sp-7)"><div class="figures" style="display:flex;width:60mm"><div><b>$184,000,000</b><span>Budget</span></div></div><div style="height:300mm">tall</div><p><b>Bold start.</b> and the rest of the words past the edge</p></section>
<section class="page" style="padding:var(--sp-7)"><header style="background:var(--accent);height:20mm"></header><h1 style="margin-top:-12mm">Title into the band</h1><nv-logo role="onDark" style="height:10mm"></nv-logo><table><tr><th style="color:var(--muted)">Grey on the band</th></tr></table><nv-block ref="b1"></nv-block><nv-block ref="b1"></nv-block><nv-block ref="b9"></nv-block></section>
<section class="page"><p>the last page</p><p style="width:15mm">Decision needed: the board approves the budget and the lease by 6 December.</p><div style="position:absolute;bottom:4mm;left:20mm">under the foot</div><footer class="nv-foot" style="position:absolute;left:16mm;right:16mm;bottom:3mm"><span>Q3</span></footer></section>`;
  const layout = D.readDesign(raw);
  assert.ok(layout);
  // The page's own script must also hold against what the string pass let through, so a layout straight from the AI
  // (with its handler and file address) is opened too.
  const sneaky = raw.replace('class="x"', 'class="x" style="background:url(file://' + work + '/secret.txt)"');
  for (const [name, lay] of [['scrubbed', layout], ['raw', sneaky]]) {
    const page = D.designPage({ kind: D.kindInfo('report'), theme: D.designTheme(KIT), title: 'Q3 plan', layout: lay, blocks: ['<h2>Why</h2><p>We open three sites.</p>', '<p>Second block.</p>'], logos: { onDark: logo, primary: darkLogo }, brandName: 'Harbour Pine', foot: 'Ops', keepAll: true, nonce: 'n0nce' });
    const file = path.join(work, `${name}.html`);
    writeFileSync(file, page);
    await browser.send('Page.navigate', { url: pathToFileURL(file).href });
    let report = null;
    for (let i = 0; i < 100 && !report; i++) {
      await sleep(100);
      report = await browser.ev('window.__report || null');
    }
    assert.ok(report, `${name}: the page reported`);
    const state = await browser.ev(`({
      handlers: [...document.querySelectorAll('*')].filter((e) => [...e.attributes].some((a) => /^on/i.test(a.name))).length,
      fileRefs: [...document.querySelectorAll('[style]')].filter((e) => /file:/.test(e.getAttribute('style'))).length + [...document.styleSheets].slice(1).flatMap((s) => [...s.cssRules]).filter((r) => /file:/.test(r.cssText)).length,
      imgs: [...document.images].map((i) => i.src.slice(0, 22)),
      logos: [...document.images].map((i) => i.getAttribute('src')),
      th: getComputedStyle(document.querySelector('th')).color,
      blocks: [...document.querySelectorAll('.nv-b')].map((b) => b.textContent),
      pageNum: document.querySelector('nv-page-number')?.textContent,
      gradient: !!document.getElementById('d-g'),
      fill: document.querySelector('rect')?.getAttribute('fill'),
      nvLeft: document.querySelectorAll('nv-block, nv-logo').length,
      scripts: document.scripts.length,
    })`);
    assert.equal(state.handlers, 0, `${name}: no event handler`);
    assert.equal(state.fileRefs, 0, `${name}: no file address in a style`);
    assert.deepEqual(state.imgs.map((s) => s.slice(0, 22)), ['data:image/svg+xml;bas', 'data:image/svg+xml;bas'], `${name}: the logos are the only pictures`);
    assert.deepEqual(state.logos, [logo, darkLogo], `${name}: the white logo on the band, and the dark one where the AI put the white logo on white`);
    assert.equal(state.th, 'rgb(255, 255, 255)', `${name}: grey words on the dark band are set in white`);
    assert.deepEqual(state.blocks, ['WhyWe open three sites.', 'Second block.'], `${name}: b1 once, b2 (never placed) added at the end`);
    assert.equal(state.nvLeft, 0);
    assert.equal(state.gradient, true, `${name}: the gradient keeps working under its new name`);
    assert.equal(state.fill, 'url(#d-g)');
    assert.equal(state.scripts, 2);
    assert.equal(report.pages, 5, `${name}: four designed pages and the rest`);
    assert.match(state.pageNum, /^1 of 5$/);
    const words = report.problems.map((p) => `${p.page}:${p.kind}:${p.words}`).join('\n');
    assert.match(words, /^2:over:content runs \d+ mm past the bottom edge and is cut off \(from "Bold start\. and the rest/m, `${name}: page 2 runs over, found by the paragraph's own words\n${words}`);
    const fig = await browser.ev(`(() => { const b = document.querySelector('.figures b'); return { fits: b.scrollWidth <= b.parentElement.clientWidth + 1, size: parseFloat(getComputedStyle(b).fontSize) }; })()`);
    assert.ok(fig.fits && fig.size < 40, `${name}: a big number too wide for its box is set smaller (${JSON.stringify(fig)})`);
    assert.match(words, /^3:empty:/m, `${name}: page 3 is mostly empty\n${words}`);
    assert.match(words, /^3:overlap:words run into another box \("Title into the band" over a coloured header\)/m, `${name}: a title over a band is named\n${words}`);
    assert.match(words, /^3:contrast:words that did not read on their background \("Grey on the band"\): set in white/m);
    assert.match(words, /^4:narrow:words squeezed into a column 15 mm wide \("Decision needed/m, `${name}: a squeezed column is named\n${words}`);
    assert.match(words, /^4:over:content runs under the footer \("under the foot"\)/m, `${name}: words under the footer are named\n${words}`);
    assert.match(words, /blocks placed more than once.*b1/);
    assert.match(words, /blocks b2 were never placed/);
    assert.deepEqual(report.unused, ['b2']);
    assert.equal(report.boxes.length, 5);
    if (name === 'scrubbed') {
      const pdf = await browser.send('Page.printToPDF', { printBackground: true, preferCSSPageSize: true, marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0 });
      const bytes = Buffer.from(pdf.result.data, 'base64').toString('latin1');
      const pages = (bytes.match(/\/Type\s*\/Page[^s]/g) || []).length;
      assert.equal(pages, report.pages, 'the PDF has the pages the report counted');
    }
  }
});
