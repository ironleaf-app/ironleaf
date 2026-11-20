// node --test tests/chat-panel-fit.test.mjs — p15-chat-panel (4 Nov 2026) plus the v8-vault-assistant trim (5 Nov 2026):
// the chat panel fits its words at the window (3456x1408) and at their usual panel widths (300 to 640, default 380).
// Under an answer the buttons Copy, Into the note, Save as note and Ask again need 376px in a 305px card and ran past
// the panel's edge, so the buttons wrap; and a long folded steps line overflowed its 22px toggle up over the head and
// down over the answer, so folded steps stay one line ending with … (every step still shows on a click). The From rows
// changed shape: two lines now (the title whole on the first, the folder and section smaller on the second) instead of
// one clipped line with the path capped at 35% — the cap is gone with the single line, and titles read whole at every
// width. The per-answer scope head is gone too (scope lives in the bar alone), thinking aloud shows live only, and
// answers hydrate like the reading view. The question, the answer's list with its number chips, the model picker,
// attach, dictate and send sit properly throughout. Each failing check fails without its fix.
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
// The window's stylesheets in the order it loads them (main.tsx), plus the chat panel's own sheet (imported by
// panels/ChatPanel.tsx, where the fit rules live), so the cascade is the window's.
const stylesheets = () => {
  const order = [...read('src/renderer/src/main.tsx').matchAll(/import '\.\/(styles\.css|styles\/[^']+\.css)';/g)].map((m) => m[1]);
  assert.ok(order.length > 10 && order[0] === 'styles.css', `${order.length} stylesheets in the window's order`);
  return [...order, 'styles/search-ask-87.css'].map((f) => `/* ${f} */\n${read(`src/renderer/src/${f}`)}`).join('\n');
};

test('the fit rules are in the panel and its sheet', () => {
  const panel = read('src/renderer/src/panels/ChatPanel.tsx');
  const css = read('src/renderer/src/styles/search-ask-87.css');
  assert.ok(panel.includes('chat-steps-folded'), 'the folded steps read through their own span');
  const row = css.match(/\.chat \.chat-actions-row \{([^}]*)\}/s)?.[1] ?? assert.fail('no actions-row rule');
  assert.ok(row.includes('flex-wrap: wrap'), 'the answer buttons wrap instead of running past the card');
  const stack = css.match(/\.chat \.chat-source-text \{([^}]*)\}/s)?.[1] ?? assert.fail('no two-line source rule');
  assert.ok(stack.includes('flex-direction: column'), 'From rows stack: the title whole above its folder');
  const rowsCss = [...css.matchAll(/\.chat \.chat-source-row \{([^}]*)\}/gs)].map((m) => m[1]).join('\n');
  assert.ok(rowsCss, 'a source-row rule');
  assert.ok(rowsCss.includes('align-items: flex-start'), 'the icon sits with the title line, not centred over two');
  assert.doesNotMatch(css, /\.chat \.chat-source-row > \.n \{[^}]*max-width: 35%/, 'no path cap any more: nothing clips beside the title');
  const folded = css.match(/\.chat \.chat-steps-folded \{([^}]*)\}/s)?.[1] ?? assert.fail('no folded-steps rule');
  assert.ok(folded.includes('text-overflow: clip') && folded.includes('white-space: nowrap'), 'folded steps stay one line and clip without dots (t207 pass 2; the toggle opens the whole)');
});

test('the trim is in the panel: no scope head, quiet steps, hydrated answers', () => {
  const panel = read('src/renderer/src/panels/ChatPanel.tsx');
  assert.doesNotMatch(panel, /sas-askhead/, 'no per-answer scope head: scope lives in the bar alone');
  assert.doesNotMatch(panel, /answerScopeWords/, 'its helper went with it');
  assert.ok(panel.includes("from '../lib/hydrate'"), 'answers hydrate like the reading view (charts draw)');
  assert.ok(panel.includes('void hydrate(body.current)'), 'each answer’s words are hydrated once drawn');
  assert.ok(panel.includes('foldSteps(shown)'), 'finished steps fold to their kinds, never a bare count');
  assert.ok(panel.includes("steps.filter((s) => s.kind !== 'say')"), 'thinking aloud is dropped from finished answers');
});

// Measured: panel widths 300 (least), 380 (usual) and 640 (most) at both windows, with a long question, long
// folded steps, a long answer carrying a list with number chips, and long From rows.
test('measured: buttons inside, names whole, steps one line, composer proper', async () => {
  assert.ok(existsSync(SHELL), `no headless Chromium (HEADLESS_SHELL): ${SHELL}`);
  const WebSocket = require('ws');
  const css = stylesheets();
  // The scene mirrors panels/ChatPanel.tsx (same classes, same order, icon sizes as rendered there).
  const svg = (s) => `<svg width="${s}" height="${s}"></svg>`;
  const scene = (panelWidth) => `<!doctype html>
<html lang="en-AU" data-theme="light" data-palette="bright">
<head><meta charset="utf-8"><style>${css}</style>
<style>html, body { margin: 0; height: 100%; } .app { height: 100vh; display: flex; } .group-body { flex: 1; min-width: 0; display: flex; flex-direction: column; } .nv-page { flex: 1; min-height: 0; }</style>
</head>
<body><div class="app" data-platform="linux"><div class="group-body"><div class="topbar"><div class="view-nav"></div></div><div class="nv-page"></div></div>
<aside class="sidebar right" style="width: ${panelWidth}px" aria-label="Chat"><div class="side-band"></div><div class="side-title"><span>Chat</span></div><div class="side-body"><div class="chat">
<div class="chat-bar"><div class="segmented small"><button>All notes</button><button class="active">This page + linked</button></div></div>
<div class="chat-log">
<div class="chat-turn user"><p>What is still outstanding on the Harbourline cart fix before the Friday review with Alex Chen and Priya Nair, and which notes mention the receipt wording?</p></div>
<div class="chat-turn assistant">
<div class="chat-steps"><button class="chat-steps-toggle" aria-expanded="false" title="Show every step">${svg(11)}<span class="chat-steps-folded">Read the very long November roster draft note for the Museum Late Shift project · Searched every note for Friday night cover and the caterer confirmation</span></button></div>
<div class="markdown chat-answer"><p>Three things are still open before Friday, and the receipt wording lives in two notes.</p>
<ul><li><strong>Chase the two failed carts (PAY-101, PAY-102)</strong> — see the <a class="internal-link" data-href="2026-11-03 Cart standup" href="#">standup notes</a><i class="cite">2</i> for who owns the follow-up.</li>
<li><strong>Retry the failed payment twice before showing an error</strong> — the <a class="internal-link" data-href="Harbourline Cart Fix" href="#">cart fix</a><i class="cite">1</i> page tracks this under What&apos;s next.</li>
<li><strong>Send the receipt v2 for review</strong> — the wording is in <a class="internal-link" data-href="Receipts v2" href="#">Receipts v2</a><i class="cite">3</i> and the <a class="internal-link" data-href="Receipts spec" href="#">spec</a><i class="cite">4</i>, and both agree on the tax line.</li></ul>
<p>The late shift roster is the only other thing due this week, but it is not part of Friday&apos;s review.</p></div>
<div class="chat-sources"><div class="glabel">From · 4</div>
<button class="srcrow chat-source-row" title="Projects/Harbourline Cart Fix/Harbourline Cart Fix.md"><span class="gtile xs slate">${svg(13)}</span><span class="chat-source-text"><span class="clip chat-source-title">Harbourline Cart Fix</span><span class="n clip">Projects/Harbourline Cart Fix · What&apos;s next</span></span></button>
<button class="srcrow chat-source-row" title="Meetings/2026-11-03 Cart standup.md"><span class="gtile xs slate">${svg(13)}</span><span class="chat-source-text"><span class="clip chat-source-title">2026-11-03 Cart standup</span><span class="n clip">Meetings/2026-11-03 Cart standup · Actions</span></span></button>
<button class="srcrow chat-source-row" title="Notes/Receipts v2.md"><span class="gtile xs slate">${svg(13)}</span><span class="chat-source-text"><span class="clip chat-source-title">Receipts v2</span><span class="n clip">Notes</span></span></button>
<button class="srcrow chat-source-row" title="Docs/Receipts spec.md"><span class="gtile xs slate">${svg(13)}</span><span class="chat-source-text"><span class="clip chat-source-title">Receipts spec</span><span class="n clip">Docs · Summary</span></span></button>
</div>
<div class="chat-actions-row">
<button class="chat-action btn" title="Copy">${svg(13)} Copy</button>
<button class="chat-action btn" title="Put into the open note at the cursor">${svg(13)} Into the note</button>
<button class="chat-action btn" title="Keep as a note of its own">${svg(13)} Save as note</button>
<button class="chat-action" title="Ask again">${svg(13)}</button>
</div>
</div>
</div>
<div class="chat-input"><button class="chat-attach" aria-label="Attach files">${svg(15)}</button><button class="chat-attach" title="Add a folder">${svg(15)}</button><textarea rows="1" placeholder="Ask about your notes, or ask for something done…" title="Ask about your notes, or ask for something done…"></textarea><button class="chat-mic" aria-label="Dictate">${svg(15)}</button><button class="chat-send" aria-label="Send">${svg(14)}</button></div>
<div class="chat-modelfoot"><button class="chat-model">${svg(14)}<span>Recommended</span>${svg(12)}</button></div>
</div></div></aside></div></body></html>`;
  const dir = mkdtempSync(path.join(tmpdir(), 'nv-chat-panel-fit-'));
  const files = new Map();
  for (const w of [300, 380, 640]) {
    const file = path.join(dir, `chat-${w}.html`);
    writeFileSync(file, scene(w));
    files.set(w, file);
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
    for (const [W, H, P] of [[1219, 709, 300], [1219, 709, 380], [3456, 1408, 380], [3456, 1408, 640]]) {
      await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
      await send('Page.navigate', { url: pathToFileURL(files.get(P)).href });
      let ready = false;
      for (let i = 0; i < 60 && !ready; i++) {
        await sleep(150);
        try {
          ready = await ev(`!!document.querySelector('.chat-actions-row .btn')`);
        } catch {}
      }
      assert.ok(ready, `the chat drew at ${W}x${H} panel ${P}`);
      const m = await ev(`(() => {
        const rect = (el) => { const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, w: b.width, h: b.height }; };
        const log = document.querySelector('.chat-log');
        const card = document.querySelector('.chat-turn.assistant');
        const btns = [...card.querySelectorAll('.chat-actions-row button')].map((b) => ({ words: (b.innerText || b.title || '').trim().slice(0, 14), ...rect(b) }));
        const rows = [...card.querySelectorAll('.chat-source-row')].map((el) => {
          const title = el.querySelector('.chat-source-title');
          const tail = el.querySelector('.chat-source-text > .n');
          const tb = title.getBoundingClientRect();
          const lb = tail.getBoundingClientRect();
          const rb = el.getBoundingClientRect();
          return { title: title.textContent.slice(0, 24), titleW: title.clientWidth, titleFull: title.scrollWidth, titleBottom: tb.bottom, tailTop: lb.top, left: rb.left, right: rb.right };
        });
        const tog = card.querySelector('.chat-steps-toggle');
        const folded = tog.querySelector('.chat-steps-folded');
        const q = document.querySelector('.chat-turn.user > p');
        const ans = card.querySelector('.chat-answer');
        const cites = [...ans.querySelectorAll('.cite')].map((c) => {
          const r = rect(c);
          const prev = c.previousElementSibling ? rect(c.previousElementSibling) : null;
          return { ...r, ml: parseFloat(getComputedStyle(c).marginLeft) || 0, sameLine: prev ? Math.abs(r.top - prev.top) < r.h : false, gap: prev ? r.left - prev.right : null };
        });
        const input = document.querySelector('.chat-input');
        const parts = [...input.children].map((el) => rect(el));
        const foot = document.querySelector('.chat-modelfoot .chat-model');
        return {
          log: { clientW: log.clientWidth, scrollW: log.scrollWidth }, card: rect(card), btns, rows,
          tog: { h: tog.clientHeight, scrollH: tog.scrollHeight, ...rect(tog) },
          folded: { w: folded.clientWidth, full: folded.scrollWidth, ellipsis: getComputedStyle(folded).textOverflow },
          q: { clientW: q.clientWidth, scrollW: q.scrollWidth, ...rect(q) },
          ans: { clientW: ans.clientWidth, scrollW: ans.scrollWidth, ...rect(ans) },
          cites, input: rect(input), parts, foot: rect(foot), chat: rect(document.querySelector('.chat')),
        };
      })()`);
      const where = `${W}x${H} panel ${P}`;
      assert.ok(m.log.scrollW <= m.log.clientW + 1, `${where}: the log never scrolls sideways (${m.log.scrollW} in ${m.log.clientW})`);
      for (const b of m.btns) assert.ok(b.right <= m.card.right + 1, `${where}: ${b.words} stays in the card (${b.right.toFixed(1)} in ${m.card.right.toFixed(1)})`);
      assert.ok(m.btns.every((b) => b.left >= m.card.left - 1), `${where}: every button starts in the card`);
      // Two-line rows: every title reads whole at every width (nothing beside it to clip against), the
      // folder sits under its title, and every row stays in the card.
      for (const r of m.rows) {
        assert.ok(r.titleW >= r.titleFull - 1, `${where}: ${r.title} reads whole (${r.titleW} of ${r.titleFull})`);
        assert.ok(r.tailTop >= r.titleBottom - 2, `${where}: ${r.title} keeps its folder underneath`);
        assert.ok(r.left >= m.card.left - 1 && r.right <= m.card.right + 1, `${where}: ${r.title} stays in the card`);
      }
      // Folded steps stay one line and clip without dots, inside the card and the toggle's own box
      // (t207 pass 2; the toggle opens the whole).
      assert.ok(m.tog.scrollH <= m.tog.h + 1, `${where}: the folded steps fit their toggle (${m.tog.scrollH} in ${m.tog.h})`);
      assert.equal(m.folded.ellipsis, 'clip', `${where}: the long folded line clips without dots`);
      assert.ok(m.folded.full > m.folded.w, `${where}: the folded words are long enough to prove it`);
      assert.ok(m.tog.right <= m.card.right + 1, `${where}: the toggle stays in the card`);
      // The long question, the answer with its list and chips, and the composer all sit properly.
      assert.ok(m.q.scrollW <= m.q.clientW + 1, `${where}: the long question wraps inside its bubble`);
      assert.ok(m.q.right <= m.card.right + 1 && m.q.left >= m.card.left - 1, `${where}: the question sits over its answer`);
      assert.ok(m.ans.scrollW <= m.ans.clientW + 1, `${where}: the long answer never runs wide`);
      for (const c of m.cites) assert.ok(c.left >= m.ans.left - 1 && c.right <= m.ans.right + 1, `${where}: a number chip sits inside the answer`);
      // A citation marker never prints as a bare digit stuck to a word (5 Nov 2026, the real app: the side
      // chat read "…meeting1 is with the former host app now" — the source chip flush against its link,
      // the chat's answer carrying no chip gap of its own). Each chip carries its own gap and stands off
      // its link.
      assert.ok(m.cites.length > 0, `${where}: chips to prove the gap`);
      assert.ok(m.cites.some((c) => c.sameLine), `${where}: a chip on its link's line`);
      for (const c of m.cites) assert.ok(c.ml >= 3, `${where}: a number chip carries its own gap (${c.ml}px)`);
      for (const c of m.cites.filter((c) => c.sameLine)) assert.ok(c.gap >= 3, `${where}: the chip stands off its link (${c.gap.toFixed(1)}px)`);
      for (const p of m.parts) assert.ok(p.left >= m.input.left - 1 && p.right <= m.input.right + 1, `${where}: every composer part sits in its box`);
      assert.ok(m.input.right <= m.chat.right + 1 && m.foot.right <= m.chat.right + 1, `${where}: the box and the model picker sit in the panel`);
    }
    ws.close();
  } finally {
    child.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});
