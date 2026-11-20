// node --test tests/p18-small-window.test.mjs (p18, 4 Nov 2026): tonight's work was judged at 3456x1408;
// the walk at 1219x709, 1440x900 and 1920x1080 found four small-window faults. An Inbox row whose lead
// suggestion names a long project ("File to Northside Community Garden Shed Rebuild") squeezes its words to
// a sliver, slides the lead button over the title's first words, and hangs the bin past the card's edge, at
// every window, since the page caps at 960. The Decisions tab's flowed meeting actions and dates that
// went by still clip their titles to one line with no whole words on hover (tonight's two-line pass missed
// them). The Timeline tab's legend crushes into an eight-line rail beside its switches at 1219. A note's
// long fact pill runs past its column's edge with the chat open. Each failing check fails without its fix.
// (A fifth candidate, mid-word clamp breaks like "all thre…", renders the same under every overflow-wrap:
// the clamp cuts mid-word by platform design, as one-line ellipses do, and the rows keep whole words on
// hover; there is nothing to pin.)
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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

test('the fit rules are in their sheets and rows', () => {
  const w2a = read('src/renderer/src/styles/w2a.css');
  const hub = read('src/renderer/src/styles/project-hub.css');
  const note = read('src/renderer/src/styles/note-page.css');
  const inbox = read('src/renderer/src/views/InboxPage.tsx');
  const tabs = read('src/renderer/src/views/project/ProjectTabs87.tsx');

  // F1: the Inbox row wraps its actions under its words instead of squeezing both.
  const row = w2a.match(/\.w2a-ib \{([^}]*)\}/s)?.[1] ?? assert.fail('no inbox-row rule');
  assert.ok(row.includes('flex-wrap: wrap'), 'the row wraps instead of squeezing its words to a sliver');
  const words = w2a.match(/\.w2a-ib-words \{([^}]*)\}/s)?.[1] ?? assert.fail('no inbox-words rule');
  assert.ok(/flex: 1 1 \d+px/.test(words), 'the words keep a readable basis before the actions wrap under');
  const actions = w2a.match(/\.w2a-ib-actions \{([^}]*)\}/s)?.[1] ?? assert.fail('no inbox-actions rule');
  assert.ok(actions.includes('flex-wrap: wrap'), 'wrapped actions wrap among themselves instead of hanging past the card');
  const lead = w2a.match(/\.w2a-ib-actions \.btn\.pri \{([^}]*)\}/s)?.[1] ?? assert.fail('no lead-button cap');
  assert.ok(/max-width: \d+px/.test(lead), 'the lead File-to button caps instead of taking the whole row');
  const leadwords = w2a.match(/\.w2a-ib-leadwords \{([^}]*)\}/s)?.[1] ?? assert.fail('no lead-words rule');
  assert.ok(leadwords.includes('white-space: normal') && leadwords.includes('overflow-wrap: break-word'), 'capped lead words wrap whole inside the cap (t249: titles a person must read wrap whole)');
  assert.ok(inbox.includes('w2a-ib-leadwords'), 'the lead button reads through the capped span');
  assert.ok(inbox.includes('title={`${fileToWords(lead)}'), 'the button hovers its full words');

  // F2: the missed Decisions rows wrap whole with whole words on hover (t207 pass 2); the meeting actions
  // stand in the one task row (t208: tick | title | who | when, as a step).
  assert.ok(tabs.includes('<div className="trow tkrow" data-action={a.id}'), 'meeting actions stand in the one task row');
  assert.ok(tabs.includes('<span className="clip-2" title={plain(a.what)}>'), 'their titles wrap whole with hover words');
  assert.ok(tabs.includes('<WhoCell name={visibleWho(a.person || a.who, ctx.hub.me) || undefined} />'), 'who sits in its column (your own hidden, as Today)');
  // t12, 8 Nov 2026 — the to-confirm second list is gone (gone-by dates are marked in Key dates, counted at the
  // top), so the small-window rule lives on the one date row: whole words on hover.
  assert.ok(!tabs.includes('title={plain(a.title)}'), 'no second naming of the dates gone by');
  assert.ok(tabs.includes('<span className="t" title={plain(m.what)}>'), 'key date rows keep whole words on hover (t218: sized by the compact row, never inline)');
  assert.ok(tabs.includes('>Went by</span>'), 'the gone-by mark reads beside the words');
  assert.ok(tabs.includes('w2a-tworows'), 'the filed-actions card keeps the two-line rows');
  const two = w2a.match(/\.w2a-tworows \.trow \{([^}]*)\}/s)?.[1] ?? assert.fail('no two-line top-align rule');
  assert.ok(two.includes('align-items: flex-start'), 'two-line titles top-align with their meta and buttons');

  // F4: the timeline legend keeps the row's width; the switches step below when the page narrows.
  const leg = hub.match(/@container pj \(max-width: \d+px\) \{([^}]*\{[^}]*\}[^}]*)\}/s)?.[1] ?? assert.fail('no narrow-page legend rule');
  assert.ok(leg.includes('.pt-tools') && leg.includes('flex-basis: 100%'), 'narrow pages stack the switches under the legend');
  // The page-tabs bar shares the plan header's class (t265, 13 Nov 2026: t255's later sheet sat its nowrap
  // bar on this header and the stacking above stopped): its sheet scopes the bar to the tablist role, so
  // this header keeps its wrap.
  const pagetabs = read('src/renderer/src/styles/page-tabs.css');
  assert.ok(pagetabs.includes('.pt-bar[role="tablist"]'), 'the tabs bar is scoped to its tablist role');
  assert.ok(!/^\.pt-bar \{/m.test(pagetabs), 'no bare bar rule left to sit on the plan header');
  const planbar = hub.match(/\.pt-bar \{([^}]*)\}/s)?.[1] ?? assert.fail('no plan-header rule');
  assert.ok(planbar.includes('flex-wrap: wrap'), 'the plan header keeps its wrap');

  // F5: a note's long fact pill wraps inside its column instead of running past its edge.
  const fact = note.match(/\.field-fact, \.field-factbtn \{([^}]*)\}/s)?.[1] ?? assert.fail('no fact-button rule');
  assert.ok(fact.includes('min-width: 0') && fact.includes('max-width: 100%'), 'the fact button shrinks with its column');
  const pill = note.match(/\.field-value \.plan-pill[^{]*\{([^}]*)\}/s)?.[1] ?? assert.fail('no fact-pill wrap rule');
  assert.ok(pill.includes('white-space: normal'), 'long fact pills wrap like the Overview tiles’ pills');
});

// Measured: an Inbox row with a long lead at the 1219 middles (470 with the chat open, 853 without), the
// timeline head at a narrow and a wide page, a note's facts at a narrowed column, a flowed meeting row.
test('measured: inbox wraps whole, legend stacks, pills stay inside, flowed rows two lines', async () => {
  assert.ok(existsSync(SHELL), `no headless Chromium (HEADLESS_SHELL): ${SHELL}`);
  const WebSocket = require('ws');
  const css = stylesheets();
  const svg = (s) => `<svg width="${s}" height="${s}"></svg>`;
  const inboxRow = (lead) => `<section class="card"><div class="w2a-ib">
<input type="checkbox" class="w2a-tick" aria-label="Tick"><span class="gtile sm indigo">${svg(16)}</span>
<div class="w2a-ib-words"><div class="w2a-ib-title">Confirm the community hall booking for the grant acquittal information night</div>
<div class="w2a-ib-sub">Task · due 2026-11-05</div>
<div class="w2a-ib-filein"><span>Task</span><span>File in</span><button class="chip on">${svg(12)} Northside Community Garden Shed Rebuild</button></div></div>
<div class="w2a-ib-actions">${lead ? `<button class="btn pri" title="Links to Northside Community Garden Shed Rebuild"><span class="w2a-ib-leadwords">File to Northside Community Garden Shed Rebuild</span></button>` : ''}
<button class="btn">Move to a project</button><button class="btn">File…</button><button class="btn">Done</button><button class="iconbtn danger" aria-label="Delete">${svg(14)}</button></div>
</div></section>`;
  const scene = (body) => `<!doctype html>
<html lang="en-AU" data-theme="light" data-palette="bright">
<head><meta charset="utf-8"><style>${css}</style>
<style>html, body { margin: 0; } .scene { margin: 0 auto; } .check { display: inline-block; }</style>
</head>
<body><div class="app" data-platform="linux">${body}</div></body></html>`;
  const scenes = {
    // F1: the card inner widths the walk measured (1219 with the chat open, 1219 without).
    'inbox-470': scene(`<div class="scene" style="width: 470px">${inboxRow(true)}</div>`),
    'inbox-853': scene(`<div class="scene" style="width: 853px">${inboxRow(true)}</div>`),
    'inbox-plain': scene(`<div class="scene" style="width: 853px">${inboxRow(false)}</div>`),
    // F4: the project page widths the walk measured (1219 window, 1440+ windows cap at 980).
    'legend-893': scene(`<div class="pj-page" style="width: 893px; flex: none;"><div class="pt-plan"><header class="pt-bar"><div class="pt-legend"><span><span class="pt-glyph milestone"></span> Milestone</span><span><span class="pt-glyph action"></span> Action</span><span><span class="pt-glyph action is-overdue"></span> Overdue</span><span><span class="pt-glyph action is-done"></span> Done</span><span class="pt-hint">Drag a mark to move its date</span></div><div class="pt-tools"><button class="button">Today</button><div class="pt-zoom" role="radiogroup" aria-label="Zoom"><button role="radio">Week</button><button role="radio">Month</button><button role="radio">Quarter</button></div></div></header></div></div>`),
    'legend-980': scene(`<div class="pj-page" style="width: 980px; flex: none;"><div class="pt-plan"><header class="pt-bar"><div class="pt-legend"><span><span class="pt-glyph milestone"></span> Milestone</span><span><span class="pt-glyph action"></span> Action</span><span><span class="pt-glyph action is-overdue"></span> Overdue</span><span><span class="pt-glyph action is-done"></span> Done</span><span class="pt-hint">Drag a mark to move its date</span></div><div class="pt-tools"><button class="button">Today</button><div class="pt-zoom" role="radiogroup" aria-label="Zoom"><button role="radio">Week</button><button role="radio">Month</button><button role="radio">Quarter</button></div></div></header></div></div>`),
    // F5: the narrowed facts column (the chat open beside the note at 1219).
    'facts-300': scene(`<div class="scene" style="width: 300px"><div class="note-fields"><div class="field-row" data-field="status"><div class="field-key"><span>Status</span></div><div class="field-value"><button type="button" class="field-factbtn" title="Change status"><span class="plan-pill">Waiting on the second quote from the weekend suppliers</span></button></div></div></div></div>`),
    // F2: a flowed meeting action with a long title.
    'flowed': scene(`<div class="scene" style="width: 470px"><div class="card w2a-tworows"><div class="trow"><span class="check" aria-hidden="true"></span><span class="t clip-2" style="font-size: 14px" title="Ask the council whether the shed needs a building exemption letter">Ask the council whether the shed needs a building exemption letter</span><span class="meta" style="margin-left: 12px">from 2026-11-02 Shed rebuild planning · Jonathan Weatherby-Smith</span><span class="tag">filed</span></div></div></div>`),
  };
  const dir = mkdtempSync(path.join(tmpdir(), 'nv-p18-small-window-'));
  const files = new Map();
  for (const [name, html] of Object.entries(scenes)) {
    const file = path.join(dir, `${name}.html`);
    writeFileSync(file, html);
    files.set(name, file);
  }
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
    await send('Emulation.setDeviceMetricsOverride', { width: 1219, height: 709, deviceScaleFactor: 1, mobile: false });
    const open = async (name, readySel) => {
      await send('Page.navigate', { url: pathToFileURL(files.get(name)).href });
      let ready = false;
      for (let i = 0; i < 60 && !ready; i++) {
        await sleep(150);
        try {
          ready = await ev(`!!document.querySelector(${JSON.stringify(readySel)})`);
        } catch {}
      }
      assert.ok(ready, `the ${name} scene drew`);
      await sleep(300);
    };
    const rect = async (sel) => ev(`(() => { const b = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, r: b.right, b: b.bottom }; })()`);

    // F1: the words keep room, no button touches them, the lead caps, the bin stays in the card.
    for (const name of ['inbox-470', 'inbox-853']) {
      await open(name, '.w2a-ib-actions');
      const wordsBox = await rect('.w2a-ib-words');
      assert.ok(wordsBox.w >= 200, `${name}: the words keep room (got ${Math.round(wordsBox.w)}px)`);
      const overlap = await ev(`(() => {
        const w = document.querySelector('.w2a-ib-words').getBoundingClientRect();
        return [...document.querySelectorAll('.w2a-ib-actions button')].some((b) => {
          const a = b.getBoundingClientRect();
          return a.x < w.right - 1 && a.right > w.x + 1 && a.y < w.bottom - 1 && a.bottom > w.y + 1;
        });
      })()`);
      assert.ok(!overlap, `${name}: no action button overlaps the words`);
      const lead = await rect('.w2a-ib-actions .btn.pri');
      assert.ok(lead.w <= 324, `${name}: the lead button caps (got ${Math.round(lead.w)}px)`);
      const bin = await rect('.w2a-ib-actions .iconbtn');
      const card = await rect('.card');
      assert.ok(bin.r <= card.r + 1, `${name}: the bin stays inside the card`);
    }
    // The common row (no lead) still reads one line at 1219.
    await open('inbox-plain', '.w2a-ib-actions');
    const plain = await ev(`(() => {
      const w = document.querySelector('.w2a-ib-words').getBoundingClientRect();
      const a = document.querySelector('.w2a-ib-actions').getBoundingClientRect();
      return { wordsTop: w.y, actionsTop: a.y };
    })()`);
    assert.ok(Math.abs(plain.actionsTop - plain.wordsTop) < 4, 'the plain row still reads one line');

    // F4: narrow pages stack the switches under the legend; wide pages keep them beside it.
    await open('legend-893', '.pt-tools');
    const narrow = await ev(`(() => {
      const l = document.querySelector('.pt-legend').getBoundingClientRect();
      const t = document.querySelector('.pt-tools').getBoundingClientRect();
      return { legendBottom: l.bottom, toolsTop: t.y };
    })()`);
    assert.ok(narrow.toolsTop >= narrow.legendBottom - 1, 'at a 1219 page the switches step below the legend');
    await open('legend-980', '.pt-tools');
    const wide = await ev(`(() => {
      const l = document.querySelector('.pt-legend').getBoundingClientRect();
      const t = document.querySelector('.pt-tools').getBoundingClientRect();
      return { legendBottom: l.bottom, toolsTop: t.y };
    })()`);
    assert.ok(wide.toolsTop < wide.legendBottom - 1, 'at a 980 page the switches stay beside the legend');

    // F5: the long fact pill wraps inside its column.
    await open('facts-300', '.plan-pill');
    const pillIn = await ev(`(() => {
      const v = document.querySelector('.field-value').getBoundingClientRect();
      const p = document.querySelector('.field-value .plan-pill').getBoundingClientRect();
      return { valueRight: v.right, pillRight: p.right, pillH: p.height };
    })()`);
    assert.ok(pillIn.pillRight <= pillIn.valueRight + 1, 'the pill stays inside its column');
    assert.ok(pillIn.pillH > 26, 'the long pill wraps instead of running one clipped line');

    // F2: the flowed title wraps whole, never dots, and top-aligns with its tick (t207 pass 2).
    await open('flowed', '.t.clip-2');
    const clamp = await ev(`getComputedStyle(document.querySelector('.flowed, .scene') && document.querySelector('.t.clip-2')).webkitLineClamp`);
    assert.equal(clamp, 'none', 'the flowed title never clamps with dots');
    const top = await ev(`(() => {
      const c = document.querySelector('.trow .check').getBoundingClientRect();
      const t = document.querySelector('.trow .t').getBoundingClientRect();
      const el = document.querySelector('.trow .t');
      return { checkTop: c.y, titleTop: t.y, over: el.scrollWidth - el.clientWidth };
    })()`);
    assert.ok(Math.abs(top.checkTop - top.titleTop) <= 3, 'the tick top-aligns with the wrapped title');
    assert.ok(top.over <= 1, 'the wrapped title reads whole');
  } finally {
    child.kill();
  }
});
