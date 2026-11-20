// node --test tests/sweep-a.test.mjs — the Vault visual sweep's area A (3 Nov 2026): Today, Home,
// Inbox, Projects (list, gallery, board, timeline, the project page), Meetings (list, calendar, a
// meeting), Shared spaces, and the Vault header, rail and bell on those pages. The layout checks
// draw minimal faithful markup in headless Chromium with the window's real stylesheets (main.tsx
// order plus the views' own CSS imports, the way Vite bundles them); the source checks pin the
// one-line wirings. Fails without each change.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

process.env.no_proxy = [process.env.no_proxy, '127.0.0.1,localhost'].filter(Boolean).join(',');
process.env.NO_PROXY = [process.env.NO_PROXY, '127.0.0.1,localhost'].filter(Boolean).join(',');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SHELL = process.env.HEADLESS_SHELL || (process.env.HOME || '') + '/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell';

// The window's stylesheets in the order it loads them, plus the views' own CSS imports
// (MeetingsPage imports w2b.css itself; main.tsx alone would miss it).
function stylesheets() {
  const order = [...read('src/renderer/src/main.tsx').matchAll(/import '\.\/(styles\.css|styles\/[^']+\.css)';/g)].map((m) => m[1]);
  assert.ok(order.length > 10 && order[0] === 'styles.css', `${order.length} stylesheets in the window's order`);
  const extra = ['w2b.css', 'vault-home.css', 'page-states-87.css'].filter((f) => !order.includes(`styles/${f}`));
  return [...order.map((f) => read(`src/renderer/src/${f}`)), ...extra.map((f) => read(`src/renderer/src/styles/${f}`))].join('\n');
}

// F-A1: Meetings draws the shared header row in every state, and the frame doesn't double it.
test('meetings draws the shared header row, once', () => {
  const page = read('src/renderer/src/views/modules/work/MeetingsPage.tsx');
  assert.ok(page.includes("from '../../ViewHeader'") || page.includes('from "../../ViewHeader"'), 'MeetingsPage wires ViewHeader');
  assert.ok(page.includes('<ViewHeader tab={tab}'), 'MeetingsPage draws the header row for its tab');
  const ws = read('src/renderer/src/views/Workspace.tsx');
  assert.ok(/SELF_HEADER = new Set(?:<[^>]*>)?\(\[[^\]]*'meetings'[^\]]*\]\)/.test(ws), 'the frame leaves the header to the Meetings page');
});

// F-A6: the decorative hero art is gone from the project page.
test('no decorative hero art on the project page', () => {
  const page = read('src/renderer/src/views/ProjectPage.tsx');
  assert.ok(!page.includes('HeroArt'), 'the art is unwired from ProjectPage');
  assert.ok(!existsSync(path.join(root, 'src/renderer/src/components/HeroArt.tsx')), 'the orphaned art component is deleted');
});

// F-A9: the area's pages share the frame's 36px sides (titles start at one x).
test("area pages don't override the frame's side pad", () => {
  for (const f of ['src/renderer/src/views/InboxPage.tsx', 'src/renderer/src/views/ProjectsHome.tsx', 'src/renderer/src/views/SharedSpacesHome.tsx', 'src/renderer/src/views/SharedSpacePage.tsx', 'src/renderer/src/views/ProjectPage.tsx']) {
    const src = read(f);
    assert.ok(!src.includes('24px 40px') && !src.includes('24px 32px'), `${f} keeps the default side pad`);
  }
  assert.ok(read('src/renderer/src/styles/w2a.css').includes('-36px -36px'), 'the project hero breakout follows the pad');
});

// p14 (4 Nov 2026 at 3456): the shared-spaces pages cap their wide page, like Projects, Tasks and
// the project page. Without it a space's name sits at one edge and its count 2,500 px away, and the empty page
// floats in the middle of the void. p25 one column: the cap is the frame's --page-max, not 980 here — the spaces
// list stands in the frame with every other room (a space's own pages keep their 980: out of p25's rooms).
test("shared spaces keep the lists' column on a wide window", () => {
  const home = read('src/renderer/src/views/SharedSpacesHome.tsx');
  assert.ok(home.includes('<div className="vpage wide">') && !home.includes('maxWidth:'), 'the spaces list stands in the frame, carrying no width of its own');
  assert.ok(/\.vscroll > \.vpage\.wide \{[^}]*max-width: var\(--page-max\)/s.test(read('src/renderer/src/styles/page-frame.css')), 'the frame caps it at the one width');
  const page = read('src/renderer/src/views/SharedSpacePage.tsx');
  const capped = (page.match(/<div className="vpage wide" style=\{\{ maxWidth: 980 \}\}>/g) || []).length;
  assert.equal(capped, 3, 'a space caps its loading, gone and content roots');
  assert.equal(capped, (page.match(/<div className="vpage wide"/g) || []).length, 'no uncapped wide root left');
});

// F-A10: no "0 open" pill above an empty page (Inbox already hides its count when empty).
test('empty pages hide their count pill', () => {
  assert.ok(!read('src/renderer/src/views/ProjectsHome.tsx').match(/\{openCount[^}]*\} open<\/span>/) || read('src/renderer/src/views/ProjectsHome.tsx').includes('openCount > 0'), 'Projects hides 0 open');
  assert.ok(read('src/renderer/src/views/SharedSpacePage.tsx').includes('openCount > 0'), 'a shared space hides 0 open');
});

// F-A11: every clipped one-liner carries its full words as a tooltip.
test('clipped rows expose their full words', () => {
  const projects = read('src/renderer/src/views/ProjectsHome.tsx');
  assert.ok(projects.includes('title={c.name}'), 'project rows and cards tooltip their name');
  const meetings = read('src/renderer/src/views/modules/work/MeetingsPage.tsx');
  // t248: the note is the meeting — meeting actions read in the note's Tasks rows, each carrying its
  // full words on hover (the connected tip rode the gone ActionsCard).
  const note = read('src/renderer/src/views/MeetingActions.tsx');
  assert.ok(note.includes('title={r.what}'), 'meeting actions tooltip their words');
  assert.ok(meetings.includes('title={x.text}'), 'agenda lines tooltip their words');
});

// F-A2/A3/A4/A5/A7/A8: the measured layout.
test('area heads, gallery, rows, gantt, section heads and filters keep their room', async () => {
  assert.ok(existsSync(SHELL), `no headless Chromium: ${SHELL}`);
  const css = stylesheets();
  const longName = 'The Complete Rebuild of the Company Website Including the Shop and the Blog';
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>
<div id="wrap" style="width:840px">
<div class="vpage wide" id="vpage">
<div class="w2a-head" id="w2ahead"><h1 class="w2a-title">Projects</h1><span class="pill slate">8 open</span></div>
<div class="gal" id="gal">
<button class="gcard w2a-cardbtn"><span class="gtile slate"></span><div class="t w2a-clip">${longName}</div><div class="s w2a-clip">in 40 days</div></button>
<button class="gcard w2a-cardbtn"><span class="gtile slate"></span><div class="t w2a-clip">Studio Upgrade</div><div class="s w2a-clip">in 5 days</div></button>
<button class="gcard w2a-cardbtn"><span class="gtile slate"></span><div class="t w2a-clip">EOFY Tax Pack</div><div class="s w2a-clip">in 2 days</div></button>
</div>
<div class="card" style="padding:6px 20px;margin-top:12px"><div class="trow w2a-rowbtn" id="prow"><span class="gtile xs slate"></span><span class="t w2a-clip">${longName}</span><span class="pill slate" style="margin-left:12px">On track</span><span class="meta w2a-clip" id="prometa" style="margin-left:auto">1 next step · in 40 days</span></div></div>
<div class="card" style="padding:16px 22px;margin-top:12px"><div class="gantt"><div class="grow"><span class="nm">Studio Upgrade</span><div class="gtrack" id="gtrack"><button class="gbar slate" id="gbar" style="left:2%;width:2%"><span class="w2a-clip">in 5 days</span></button></div></div></div></div>
</div>
<div class="w2b-title" id="w2btitle"><span class="gtile slate"></span><h1 class="vtitle clip">Supplier call</h1></div>
<div class="w2b-sechead" id="sechead"><div class="glabel w2b-group">Actions found · 2, tick to keep</div><button class="button small">Tasks</button><button class="button small">Remind me</button><button class="button primary small">Add all 2</button></div>
<div class="chips w2b-chips" id="w2bchips"><button class="chip on">Upcoming</button><button class="chip">Past</button><button class="chip">Series</button><button class="chip">Every action</button><button class="chip">Every decision</button><select class="select w2b-project" id="w2bproject"><option>All projects</option></select></div>
</div>
</body></html>`;
  const work = mkdtempSync(path.join(tmpdir(), 'nv-sweep-a-'));
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
      const head = r('#w2ahead'), title = document.querySelector('#w2ahead h1').getBoundingClientRect();
      const wt = r('#w2btitle'), wv = document.querySelector('#w2btitle h1').getBoundingClientRect();
      const gal = document.querySelector('#gal'), vp = document.querySelector('#vpage');
      const meta = document.querySelector('#prometa'), gb = document.querySelector('#gbar');
      const btns = [...document.querySelectorAll('#sechead .button')].map((b) => b.getBoundingClientRect());
      const chip = r('#w2bchips .chip'), sel = r('#w2bproject');
      return {
        headDead: head.height - title.height, w2bDead: wt.height - wv.height,
        galOver: vp.scrollWidth - vp.clientWidth,
        metaOver: meta.scrollWidth - meta.clientWidth,
        gbarClip: getComputedStyle(gb).overflowX, gbarW: gb.getBoundingClientRect().width,
        spread: btns[1].left - btns[0].right, spread2: btns[2].left - btns[1].right,
        selRow: sel.top - chip.top,
      };
    })()`);
    assert.ok(m.headDead <= 4, `the w2a head keeps no dead space (saw ${m.headDead}px)`);
    assert.ok(m.w2bDead <= 4, `the meeting title keeps no dead space (saw ${m.w2bDead}px)`);
    assert.equal(m.galOver, 0, `the gallery never overruns the page (saw +${m.galOver}px)`);
    assert.equal(m.metaOver, 0, `a row's due words never clip (saw +${m.metaOver}px)`);
    assert.equal(m.gbarClip, 'hidden', `a sliver bar clips its label inside (saw overflow-x ${m.gbarClip})`);
    assert.ok(m.gbarW >= 40, `a sliver bar stays clickable (saw ${m.gbarW}px)`);
    assert.ok(m.spread <= 20 && m.spread2 <= 20, `section-head buttons cluster right (saw gaps ${m.spread}/${m.spread2}px)`);
    assert.ok(Math.abs(m.selRow) <= 4, `the meetings filter sits in the chips row (saw ${m.selRow}px below)`);
    ws.close();
  } finally {
    child.kill('SIGKILL');
    rmSync(work, { recursive: true, force: true });
  }
});
