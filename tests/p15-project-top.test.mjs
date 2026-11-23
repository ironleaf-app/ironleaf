// node --test tests/p15-project-top.test.mjs — a project's top and folio (p15, 4 Nov 2026; the folio 5 Nov 2026):
// at 3456x1408 the title, the waiting-from-notes bar, the sticky line and the sections share one frame (one left
// edge, one right edge), and Waiting, People, Risks and Updates read long content in equal rows with no clipped
// words. Fails without each change.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cssPxFor } from './css-px.mjs';

process.env.no_proxy = [process.env.no_proxy, '127.0.0.1,localhost'].filter(Boolean).join(',');
process.env.NO_PROXY = [process.env.NO_PROXY, '127.0.0.1,localhost'].filter(Boolean).join(',');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => cssPxFor(f, readFileSync(path.join(root, f), 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SHELL = process.env.HEADLESS_SHELL || (process.env.HOME || '') + '/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell';

function stylesheets() {
  const order = [...read('src/renderer/src/main.tsx').matchAll(/import '\.\/(styles\.css|styles\/[^']+\.css)';/g)].map((m) => m[1]);
  assert.ok(order.length > 10 && order[0] === 'styles.css', `${order.length} stylesheets in the window's order`);
  return order.map((f) => read(`src/renderer/src/${f}`)).join('\n');
}

test('the project keeps one frame: hero, checks bar, sticky line and sections share both edges', () => {
  // 5 Nov 2026, the vault folio: the hero, tabs and body became the title block, the sticky line and the
  // sections (all plain block children of the one column, so no inset rules are needed any more).
  // v9, 6 Nov 2026: the hero is back as an inset card on the same column — one frame still.
  const css = read('src/renderer/src/styles/w2a.css');
  assert.ok(css.includes('.vpage.wide.pj-folio { max-width: 980px'), 'the one column carries every part');
  assert.ok(css.includes('.pj-page .suggestion-bar { margin-left: 0'), 'the waiting bar keeps the content width');
  assert.ok(!css.includes('.w2a-ptabs') && !css.includes('.w2a-pbody') && !css.includes('.w2a-overview'), 'no tab-era inset rules left');
  // The sweep-A breakout stays in the file for other hero uses.
  assert.ok(css.includes('-36px -36px'), 'the old breakout stays for other hero uses');
});

test('the hero pill and its menu stay in the head', () => {
  // v9, 6 Nov 2026 (the folio "gone away from looking polished like it use to"): the hero is back — the status
  // reads as the pill beside the title (always shown, never gated), and the status line is gone.
  const page = read('src/renderer/src/views/ProjectPage.tsx');
  assert.ok(page.includes('chooseStatus'), 'the head opens the status menu');
  assert.ok(page.includes('{standing.words}'), 'the pill reads the one standing (one fact, one value, 8 Nov 2026)');
  assert.ok(page.includes("label: PROP_STATUS_WORDS[v], checked: status === v"), 'the menu still ticks the stored status');
  assert.ok(!page.includes('<StatusLine') && !page.includes('pj-statusline'), 'no status line repeating the band');
  assert.ok(page.includes('w2a-readmore'), 'a long summary reads as its lead until asked');
});

test('the hero sits close: Read more follows its text, bottom padding matches the old page', () => {
  // v10, 6 Nov 2026 ("Read more" sat too far under its text): the opener follows the lead with no gap, and the
  // card's bottom padding tightens so the hero matches the old page's proportions at the same width. t255, 13 Nov
  // 2026: the hero moved under the fixed stickhead; t261: the tall top came down to the content.
  const css = read('src/renderer/src/styles/w2a.css');
  assert.ok(css.includes('.w2a-psub .w2a-readmore { margin-top: 1px'), 'Read more sits close under its text');
  assert.ok(css.includes('.pj-page .vpage.wide.pj-folio > .pj-stickhead > .nv-hero { margin: 0 0 4px; padding: 18px 18px 14px;'), 'the hero stays tight: 14px under, as compact as the content above');
});

test('the sections read two lines with the whole on hover, Risks whole like Updates', () => {
  const tabs = read('src/renderer/src/views/project/ProjectTabs87.tsx');
  // Section rows: the kit's two-line clamp, as the task rows do (not the one-line …).
  // (p17-connected: the head is a button that opens the waiting item it names; the clamp, size and hover stay.)
  assert.ok(tabs.includes('<button className="t clip-2" style={{ border: 0') && tabs.includes('title={`${g.person}'), 'Waiting reads two lines with the whole on hover (t218: sized by the compact row, never inline)');
  assert.ok(tabs.includes('title={r.title}'), 'Files name the whole on hover (t239 merged rows carry it as r.title)');
  assert.ok(tabs.includes('<span className="t clip-2">'), 'Activity reads two lines (t218: sized by the compact row, never inline)');
  assert.ok(tabs.includes('title={`Open ${x.name}'), 'People rows carry the whole name on hover');
  // Risks: whole words, as Updates does (no one-line clip).
  const risksCard = tabs.slice(tabs.indexOf('data-item-card="risks"'), tabs.indexOf('data-item-card="updates"'));
  assert.ok(!risksCard.includes('w2a-clip'), 'Risks never one-line clips');
  assert.ok(risksCard.includes('<span className="t">'), 'Risks reads whole like Updates (t218: sized by the compact row, never inline)');
});

test('measured: one frame and two-line rows with no clipped words', async () => {
  assert.ok(existsSync(SHELL), `no headless Chromium: ${SHELL}`);
  const css = stylesheets();
  const longTask = 'Chase the two carts that failed on Friday afternoon during the peak sale period with the international payment gateway provider about the retry behaviour';
  const longRisk = 'Repeat failures on old Safari browsers used by customers in the northern suburbs during peak hours with international cards on Friday evenings';
  const longLead = 'Harbour Lane Coffee Co. is the laneway cafe and its wholesale arm together: two shops, one roastery contract, and fourteen wholesale accounts across the inner west. This project holds the summer rebuild in one place, and the refit runs through November with joinery back on site Monday.';
  // t255, 13 Nov 2026: the folio's section bar became real tabs under the fixed stickhead — the fixture
  // stands the hero in the stickhead with the shared tab bar, as the page does; every rule below is unchanged.
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>
<div class="pj-page" id="pj" style="width:1200px">
<div class="vpage wide pj-folio is-tabs" id="vpage">
<div class="pj-stickhead" id="stick">
<div class="nv-hero" id="hero"><div class="w2a-phead"><span class="gtile slate">◧</span><h1 class="w2a-title" id="title">Harbourline</h1><span class="pill red">At risk</span></div>
<div class="w2a-psub"><span class="w2a-clip" id="lead">${longLead}</span> <button class="w2a-readmore" id="more">Read more</button></div></div>
<div class="pt-bar" role="tablist" aria-label="Project sections" id="nav" data-fade="none"><button role="tab" class="pt-tab is-on"><span class="pt-title">Overview</span></button><button role="tab" class="pt-tab"><span class="pt-title">What&apos;s next</span></button><button role="tab" class="pt-tab"><span class="pt-title">Waiting</span></button></div>
</div>
<div style="margin-bottom:12px"><div class="suggestion-bar" id="checks"><span class="suggestion-bar-words">2 waiting from your notes</span></div></div>
<section class="pj-folio-sec" data-section="waiting" id="sec"><div class="pj-folio-head"><h2>Waiting</h2></div>
<div class="card"><div class="trow" id="waitrow"><i class="miniava slate">PN</i><button class="t clip-2" id="waitt" style="font-size:14px;border:0;background:none;font-family:inherit;color:inherit;text-align:left;padding:0">${longTask}</button><button class="btn quiet" style="height:28px">Chase</button></div></div>
</section>
<div class="card" data-item-card="risks"><div class="trow" id="riskrow"><span class="t" id="riskt" style="font-size:14px">${longRisk}</span><span style="margin-left:auto;display:flex;gap:6px"><button class="btn quiet" style="height:28px">Close</button></span></div></div>
</div>
</div>
</body></html>`;
  const work = mkdtempSync(path.join(tmpdir(), 'nv-p15-'));
  writeFileSync(path.join(work, 'page.html'), html);
  const net = await import('node:net');
  const port = await new Promise((resolve) => { const s = net.createServer(() => {}); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const child = spawn(SHELL, ['--headless', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${port}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
  try {
    let target;
    for (let i = 0; i < 100 && !target; i++) { await sleep(150); try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((x) => x.type === 'page'); } catch {} }
    assert.ok(target, 'the browser opened');
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((r) => (ws.onopen = r));
    let id = 1; const pending = new Map();
    ws.onmessage = (m) => { const d = JSON.parse(typeof m.data === 'string' ? m.data : m.data.toString()); if (d.id && pending.has(d.id)) { pending.get(d.id)(d.result); pending.delete(d.id); } };
    const send = (method, params = {}) => new Promise((resolve) => { const i = id++; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })); });
    const ev = async (e) => (await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result?.value;
    await send('Page.enable'); await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1219, height: 709, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: pathToFileURL(path.join(work, 'page.html')).href });
    let ready = false;
    for (let i = 0; i < 60 && !ready; i++) { await sleep(150); try { ready = await ev(`!!document.querySelector('#vpage')`); } catch {} }
    assert.ok(ready, 'the page loaded');
    const m = await ev(`(() => {
      const r = (s) => document.querySelector(s).getBoundingClientRect();
      const hero = r('#hero'), checks = r('#checks'), nav = r('#nav'), sec = r('#sec');
      const waitt = document.querySelector('#waitt'), riskt = document.querySelector('#riskt'), lead = document.querySelector('#lead');
      const single = parseFloat(getComputedStyle(waitt).fontSize) * 1.5;
      const leadSingle = parseFloat(getComputedStyle(lead).fontSize) * 1.5;
      return {
        heroL: hero.left, heroR: hero.right, checksL: checks.left, checksR: checks.right, navL: nav.left, navR: nav.right, secL: sec.left, secR: sec.right,
        waitH: waitt.getBoundingClientRect().height, waitLines: waitt.getBoundingClientRect().height / single,
        waitClip: waitt.scrollWidth - waitt.clientWidth,
        riskClip: riskt.scrollWidth - riskt.clientWidth, riskH: riskt.getBoundingClientRect().height,
        leadLines: lead.getBoundingClientRect().height / leadSingle,
        more: !!document.querySelector('#more'),
      };
    })()`);
    for (const [a, b, name] of [[m.heroL, m.navL, 'hero/nav left'], [m.heroR, m.navR, 'hero/nav right'], [m.checksL, m.secL, 'checks/section left'], [m.checksR, m.secR, 'checks/section right'], [m.heroL, m.secL, 'hero/section left'], [m.heroR, m.secR, 'hero/section right']]) {
      assert.ok(Math.abs(a - b) <= 1, `one frame: ${name} matches (saw ${a} vs ${b})`);
    }
    assert.ok(m.leadLines > 1.4 && m.leadLines < 2.6, `the lead reads two lines at most (saw ${m.leadLines.toFixed(1)} lines)`);
    assert.ok(m.more, 'one Read more opens the whole');
    assert.ok(m.waitLines > 1.4, `a long waiting row reads two lines (saw ${m.waitLines.toFixed(1)} lines)`);
    assert.ok(m.waitLines < 2.6, `a waiting row never takes a third line (saw ${m.waitLines.toFixed(1)} lines)`);
    assert.ok(m.riskClip <= 2, `a long risk wraps whole (saw +${m.riskClip}px clipped)`);
    ws.close();
  } finally {
    child.kill('SIGKILL');
    rmSync(work, { recursive: true, force: true });
  }
});
