// node --test tests/today-cards-whole-lines.test.mjs — no card ever cuts words (Nov 2026 review:
// the Today page's Meetings card cut its last line ("11 actions from meetings to carry into projects")
// partway through a line: the carry row wears the single-line button's height, crushing its two lines
// into each other). A card holds what fits in whole lines and whole rows, and what does not fit is
// reached another way (the Family card's rows past five had no way at all: they gain the card's link,
// as the Bills and Habits cards have). Every home card renders whole lines with long realistic content
// at 3456x1408, 1920x1117 and 1219x709. Each failing check fails without its fix.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
process.env.no_proxy = [process.env.no_proxy, '127.0.0.1,localhost'].filter(Boolean).join(',');
process.env.NO_PROXY = [process.env.NO_PROXY, '127.0.0.1,localhost'].filter(Boolean).join(',');
const root = path.join(import.meta.dirname, '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SHELL = process.env.HEADLESS_SHELL || (process.env.HOME || '') + '/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell';
// The window's stylesheets in the order it loads them (main.tsx), so the cascade is the window's.
const stylesheets = () => {
  const order = [...read('src/renderer/src/main.tsx').matchAll(/import '\.\/(styles\.css|styles\/[^']+\.css)';/g)].map((m) => m[1]);
  assert.ok(order.length > 10 && order[0] === 'styles.css', `${order.length} stylesheets in the window's order`);
  return order.map((f) => `/* ${f} */\n${read(`src/renderer/src/${f}`)}`).join('\n');
};

test('a row that reads as a button still sizes as a row, and the Family card links on', () => {
  const css = read('src/renderer/src/styles/record-modules.css');
  const rule = css.match(/\.rm-today-row \.rm-today-main\.button\.small\s*\{([^}]*)\}/s)?.[1] ?? assert.fail('no un-crush rule for a button-classed row');
  assert.ok(/height:\s*auto/.test(rule) && /min-height:\s*0/.test(rule), 'the row’s two lines size it, never the button’s single-line height');
  assert.ok(/white-space:\s*normal/.test(rule), 'its words wrap instead of crushing');
  const home = read('src/renderer/src/views/HomeView.tsx');
  const family = home.split('export function FamilyCard')[1].split('export function useHomeLayout')[0];
  assert.ok(family.includes('home-seeall') && family.includes("openModule('family')"), 'the Family card links to Family, as the Bills and Habits cards do');
});

// Long realistic content through every home card, as the components draw it (same classes, same order).
const scene = (css) => {
  const prep = (name, sub) => `<li class="rm-today-row"><button type="button" class="rm-today-main"><span class="rm-today-name">${name}</span><span class="rm-today-sub">${sub}</span></button><button type="button" class="button small">Prep</button></li>`;
  const trow = (t, meta) => `<div class="trow"><button class="home-open"><span class="t clip-2">${t}</span>${meta ? `<span class="meta clip-2">${meta}</span>` : ''}</button></div>`;
  return `<!doctype html>
<html lang="en-AU" data-theme="light" data-palette="bright">
<head><meta charset="utf-8"><style>${css}</style>
<style>html, body { margin: 0; } body { background: var(--bg); }</style>
</head>
<body><div class="td-view"><div class="td-inner tklist">
<div class="tm-modules">
<section class="td-section rm-today wmt-today" data-section="meetings" aria-labelledby="td-h-meetings">
<header class="td-section-head"><h2 id="td-h-meetings">Meetings <span class="td-count">4</span></h2></header>
<ul class="rm-today-rows">
${prep('Harbour fit-out weekly review with the landlord and the lighting contractor', 'Today 9:00 am · 3 open items with the people coming')}
${prep('Winter menu tasting with Alex Lee and the bakery team', 'Today 2:30 pm · nothing open with the people coming')}
${prep('Studio upgrade rollout wave two planning session for the Sydney cafes', 'Tomorrow 10:00 am · 5 open items with the people coming')}
${prep('Supplier call with Western Plains Mill about the winter flour order', 'Tomorrow 4:00 pm · 1 open item with the people coming')}
${prep('2026-11-03 Cart standup retrospective follow-up session', '3 open actions · carry them into their projects')}
${prep('Lease extension negotiation second round debrief with Priya', '1 open action · carry it into its project')}
<li class="rm-today-row is-change"><button type="button" class="button small rm-today-main"><span class="rm-today-name">11 actions from meetings to carry into projects</span><span class="rm-today-sub">Each goes into its project next steps once, with who and by when.</span></button></li>
</ul>
</section>
<section class="td-section rm-today" data-section="finance"><header class="td-section-head"><h2>Money</h2></header>
<ul class="rm-today-rows">
${prep('Electricity bill for the Parramatta store overdue by 6 days', '$214.50 · was due 30 Oct')}
${prep('Council rates third instalment coming up soon after the weekend', '$486.00 · due 12 Nov')}
</ul></section>
<section class="td-section rm-today" data-section="health"><header class="td-section-head"><h2>Health</h2></header>
<ul class="rm-today-rows">
${prep('Morning walk around the harbour ticked off for today already', '6 days in a row')}
</ul></section>
</div>
<div class="home-cards">
<section aria-label="Morning brief"><div class="glabel home-label">Morning brief</div><div class="card home-card">
${trow('Chase the 11 spare tills still on the old build before Friday', 'Studio Upgrade · Mia Tran · by yesterday, longest waiting first')}
${trow('Approve the Harbourline Signs quote for the new meeting rooms', 'Harbour Fit-out · $12,400 ex GST · by tomorrow')}
</div></section>
<section aria-label="Bills due"><div class="glabel home-label">Bills due</div><div class="card home-card">
${trow('Electricity bill for the Parramatta store', 'Overdue by 6 days · $214.50')}
${trow('Council rates third instalment for the financial year', 'Due 12 Nov · $486.00 · autopay')}
</div></section>
<section aria-label="Habits to tick"><div class="glabel home-label">Habits to tick</div><div class="card home-card">
${trow('Walk around the harbour before breakfast every morning', '6 days in a row')}
${trow('Read twenty pages of the operations manual before bed', '2 days in a row')}
</div></section>
<section aria-label="Family today"><div class="glabel home-label">Family today</div><div class="card home-card">
${trow('Swimming carnival at the Olympic Park aquatic centre', 'Today 9:00 am · Ruby, Max')}
${trow('Dentist appointment for Max on the way home from school', 'Tomorrow 4:30 pm · Max')}
${trow('Aarav turns nine years old with a party on Saturday', 'In 3 days · Saturday')}
${trow('Reward earned but not given yet for the clean bedroom', 'Earned · not given yet')}
${trow('Parent teacher interviews booked for the end of term', 'Thursday · Ruby')}
${trow('Soccer training moved to the evening session this week', 'Friday 5:30 pm · Max')}
</div></section>
<section aria-label="Recently viewed"><div class="glabel home-label">Recently viewed</div><div class="home-recent">
<button class="card home-cell"><span class="home-cell-t">Harbour fit-out weekly review with the landlord</span></button>
<button class="card home-cell"><span class="home-cell-t">Winter menu tasting notes and soup scores</span></button>
<button class="card home-cell"><span class="home-cell-t">Studio upgrade reconciliation v5 for finance</span></button>
<button class="card home-cell"><span class="home-cell-t">Supplier call with Western Plains Mill minutes</span></button>
</div></section>
</div>
</div></div></body></html>`;
};

test('measured: every card holds whole lines at 3456x1408, 1920x1117 and 1219x709', { timeout: 420000 }, async () => {
  assert.ok(existsSync(SHELL), `no headless Chromium (HEADLESS_SHELL): ${SHELL}`);
  const WebSocket = require('ws');
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'nv-cards-whole-')), 'cards.html');
  writeFileSync(file, scene(stylesheets()));
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
    for (const [W, H] of [[3456, 1408], [1920, 1117], [1219, 709]]) {
      await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
      await send('Page.navigate', { url: pathToFileURL(file).href });
      let ready = false;
      for (let i = 0; i < 60 && !ready; i++) {
        await sleep(150);
        try {
          ready = await ev(`!!document.querySelector('.rm-today-rows .button.small.rm-today-main')`);
        } catch {}
      }
      assert.ok(ready, `the cards drew at ${W}x${H}`);
      // Whole lines only: a text box holds its lines whole (a deliberate two-line clamp keeps whole lines too),
      // never partway through one. A box shorter than one line, or a cut that is not on a line edge, fails.
      const cut = await ev(`(() => {
        const els = [...document.querySelectorAll('.rm-today-name, .rm-today-sub, .home-card .t, .home-card .meta, .home-cell-t')].filter((el) => (el.textContent || '').trim());
        const bad = [];
        for (const el of els) {
          const cs = getComputedStyle(el);
          const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4;
          const h = el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
          const whole = el.scrollHeight - el.clientHeight <= 2;
          const onEdge = Math.abs(h / lh - Math.round(h / lh)) < 0.2;
          if (h + 1 < lh || (!whole && !onEdge)) bad.push(\`\${el.className} "\${(el.textContent || '').trim().slice(0, 42)}" h=\${Math.round(h)} lh=\${Math.round(lh)} scroll=\${el.scrollHeight}\`);
        }
        return bad;
      })()`);
      assert.deepEqual(cut, [], `no card cuts partway through a line at ${W}x${H}: ${(cut ?? []).join(' | ')}`);
    }
    ws.close();
  } finally {
    child.kill('SIGKILL');
    rmSync(path.dirname(file), { recursive: true, force: true });
  }
});
