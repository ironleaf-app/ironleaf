// node --test tests/one-ask.test.mjs — p9-one-ask (4 Nov 2026: the floating bar over a project page got in the way): one place
// to ask, the right chat panel. The floating ask bar (components/AskBar.tsx) and its answer card
// (components/AskFloat.tsx, state/askFloat.ts) are gone with their mounts, their CSS and the data-no-askbar
// opt-outs; what the bar gave lives in the panel (page-aware suggestions, the "This page + linked" scope); every
// way in opens the panel. Each check fails with the bar back.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { cssPxFor } from './css-px.mjs';

const require = createRequire(import.meta.url);
process.env.no_proxy = [process.env.no_proxy, '127.0.0.1,localhost'].filter(Boolean).join(',');
process.env.NO_PROXY = [process.env.NO_PROXY, '127.0.0.1,localhost'].filter(Boolean).join(',');
const root = path.join(import.meta.dirname, '..');
const read = (p) => cssPxFor(p, readFileSync(path.join(root, p), 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SHELL = process.env.HEADLESS_SHELL || (process.env.HOME || '') + '/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell';
// The window's stylesheets in the order it loads them (main.tsx), so the cascade is the window's.
const stylesheets = () => {
  const order = [...read('src/renderer/src/main.tsx').matchAll(/import '\.\/(styles\.css|styles\/[^']+\.css)';/g)].map((m) => m[1]);
  assert.ok(order.length > 10 && order[0] === 'styles.css', `${order.length} stylesheets in the window's order`);
  return order.map((f) => `/* ${f} */\n${read(`src/renderer/src/${f}`)}`).join('\n');
};
const walk = (dir, out = []) => {
  for (const e of readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(rel, out);
    else if (/\.tsx?$/.test(e.name) || /\.css$/.test(e.name)) out.push(rel);
  }
  return out;
};

test('no floating ask bar or answer card anywhere: files, mounts, markers and helpers all gone', () => {
  for (const f of ['src/renderer/src/components/AskBar.tsx', 'src/renderer/src/components/AskFloat.tsx', 'src/renderer/src/state/askFloat.ts']) {
    assert.throws(() => read(f), `${f} deleted`);
  }
  const ws = read('src/renderer/src/views/Workspace.tsx');
  assert.ok(!ws.includes('AskBar') && !ws.includes('AskFloat'), 'the frame mounts neither the bar nor the card');
  // The whole mechanism's tokens: the opt-out marker, the declaration, the card state, the bar's height.
  const tokens = ['data-no-askbar', 'NoAskBar', 'sas-askbar', 'sas-asksuggest', 'sas-askmeta', 'sas-askfloat', 'sas-float-', 'sas-mic', 'sas-model', 'openAskFloat', 'closeAskFloat', 'toggleAskFloat', 'useAskFloat', 'askFloatOpen', 'askFloatTab', '--askbar-h'];
  const hits = [];
  for (const f of walk('src')) {
    const src = read(f);
    for (const t of tokens) if (src.includes(t)) hits.push(`${f}: ${t}`);
    // The bar's roomy state; the project overview's own .pj-ov.is-roomy (its wide layout, 20 Nov 2026) is another thing.
    for (const line of src.split('\n')) if (line.includes('is-roomy') && !line.includes('pj-ov')) hits.push(`${f}: is-roomy`);
  }
  assert.deepEqual(hits, [], 'no bar or card token left in src (the search foot .sas-askfoot and the panel head .sas-askhead stay, untracked here)');
});

test('nothing floats over page content at the bottom, and no page keeps room for the bar', () => {
  const css = read('src/renderer/src/styles/search-ask-87.css');
  assert.ok(!css.includes('.sas-askbar'), 'no floating bar rule');
  assert.ok(!css.includes('.sas-askfloat'), 'no floating card rule');
  assert.ok(!css.includes('--askbar-h'), 'no reported bar height');
  assert.ok(!css.includes('group-body:has(> .sas-askbar)'), 'no bottom room reserved for the bar');
  assert.ok(!css.includes('group-body:has(> .sas-askfloat)'), 'no side room reserved for the card');
});

test('the panel suggests page-aware questions for the page open', () => {
  const panel = read('src/renderer/src/panels/ChatPanel.tsx');
  assert.ok(panel.includes('suggestQuestions'), 'the panel reads the shared suggestions');
  assert.ok(panel.includes('suggestQuestions({ title: note ? A.titleOf(note) : undefined'), 'named for the page open');
  assert.ok(panel.includes('chat-suggestions') && panel.includes('chat-empty'), 'in the empty state');
  assert.ok(panel.includes('ASK_SETUP') && panel.includes('setUpProjectsFromFolder()'), 'the setup chip still runs the one setup flow');
});

test('the panel scope says This page + linked when a page is open', () => {
  const panel = read('src/renderer/src/panels/ChatPanel.tsx');
  // v8-vault-assistant: the answer head went with it ("All notes" read twice) — the bar's button reads the words once.
  assert.ok((panel.match(/This page \+ linked/g) || []).length >= 1, 'the scope button reads the bar’s words');
  assert.doesNotMatch(panel, /sas-askhead/, 'no answer head repeats them');
  assert.ok(!panel.includes('>This note<') && !panel.includes('This note\n'), 'This note is gone');
  assert.ok(panel.includes("disabled={!note}"), 'the scope needs a page');
  const css = read('src/renderer/src/styles.css');
  assert.match(css, /\.chat-bar \.segmented \{[^}]*flex: 1/, 'the scope stretches the one top row instead of clipping it');
  assert.ok(!/\.chat-bar \.segmented \{[^}]*flex: none/.test(read('src/renderer/src/styles/responsive.css')), 'no later sheet narrows it back (added 10:40 moved the model to the composer’s foot)');
  for (const t of ["tab.type === 'canvas'", "tab.type === 'view'", "tab.type === 'media'", "tab.type === 'loose'", "tab.type === 'drawing'"]) {
    assert.ok(panel.includes(t), `a ${t.slice(12, -1)} page scopes like a note does, the way the bar did`);
  }
});

test('every way in opens the right panel', () => {
  const chat = read('src/renderer/src/state/chat.ts');
  assert.ok(chat.includes("showSide('right', 'chat')"), 'asking opens the side chat');
  assert.ok(!chat.includes('openAskFloat'), 'never the floating card');
  const fit = read('src/renderer/src/state/fit.ts');
  assert.ok(fit.includes("showSide('right', 'chat')"), 'Ask (Ctrl+J) opens the side chat');
  assert.ok(fit.includes('.chat-input textarea'), 'and lands in its message box');
  assert.ok(!fit.includes('toggleAskFloat') && !fit.includes('askFloatOpen'), 'the card toggle is gone');
  const modals = read('src/renderer/src/components/Modals.tsx');
  const askBranch = modals.split("item.id.startsWith('ask:')")[1].split("item.id.startsWith('do:')")[0];
  assert.ok(askBranch.includes("showSide('right', 'chat')"), 'the top search Ask mode sends its words to the right panel');
  const commands = read('src/renderer/src/state/commands.ts');
  assert.ok(commands.includes("id: 'palette'") && commands.includes("hotkey: 'Mod+K'"), 'Ctrl+K still lists every command');
  assert.ok(commands.includes("id: 'ask'") && commands.includes("hotkey: 'Mod+J'"), 'Ctrl+J still asks');
});

test('the composer carries the model picker: the chip and menu, never hidden', () => {
  const panel = read('src/renderer/src/panels/ChatPanel.tsx');
  const barTop = panel.indexOf('<div className="chat-bar">');
  const logTop = panel.indexOf('className="chat-log"');
  const chipAt = panel.indexOf('className="chat-model"');
  assert.ok(barTop >= 0 && logTop > barTop, 'the bar and the log render in order');
  assert.ok(chipAt > logTop, 'the chip sits in the composer below the messages, not the top bar');
  assert.ok(!panel.slice(barTop, logTop).includes('chat-model'), 'the top bar keeps only the scope and New chat');
  assert.ok(panel.includes('pickModel(e.currentTarget)'), 'the chip opens the menu');
  assert.ok(panel.includes("label: 'Recommended'"), 'the default marked, in plain words');
  assert.ok(panel.includes("label: 'AI settings…'"), 'the menu’s last row opens Settings › AI, where connections and models are set up');
  assert.ok(panel.includes('settings.update({ model })'), 'the choice is used for the next answer and remembered');
  const css = read('src/renderer/src/styles.css');
  assert.ok(css.includes('.chat-modelfoot'), 'the composer foot carries it');
  assert.match(css, /\.chat-model span \{[^}]*text-overflow: clip/, 'room clips the name without dots, never hides the picker (t207 pass 2)');
  assert.ok(!/\.chat-model[^{]*\{[^}]*display: none/.test(read('src/renderer/src/styles/responsive.css')), 'no narrow width hides it');
});

test('Find and Do stay in the top search panel: one place for each', () => {
  const modals = read('src/renderer/src/components/Modals.tsx');
  assert.ok(modals.includes("'find'") && modals.includes("'do'"), 'the palette keeps Find and Do');
  assert.ok(!read('src/renderer/src/panels/ChatPanel.tsx').includes('What to do with the words'), 'the chat panel gains no modes row');
});

// Round 2 (reviewer, 11:00, on final-project-open-1219x709.png: "the composer foot is cut by the window
// bottom — the model picker (Recommended) is half off the screen, and the message box's placeholder wraps
// to a second line that is clipped"): the composer (box + foot) sits wholly inside the panel with the
// panel's own bottom padding, the hint stays one line, clipped without dots (its full words in the title), and
// the box grows upward as the person types (up to its max, then scrolls inside).
test('round 2: the composer fits, the hint stays one line, the box grows up', () => {
  const panel = read('src/renderer/src/panels/ChatPanel.tsx');
  const css = read('src/renderer/src/styles.css');
  const resp = read('src/renderer/src/styles/responsive.css');
  const ph = resp.match(/\.chat-input textarea::placeholder\s*\{([^}]*)\}/s)?.[1] ?? assert.fail('no placeholder rule');
  assert.ok(ph.includes('white-space: nowrap'), 'the hint never wraps to a clipped second line');
  assert.ok(ph.includes('overflow: hidden'), 'it clips inside the box');
  assert.ok(ph.includes('text-overflow: clip'), 'it clips without dots when long (t207 pass 2)');
  const shown = resp.match(/\.chat-input textarea:placeholder-shown\s*\{([^}]*)\}/s)?.[1] ?? assert.fail('no empty-box rule');
  assert.ok(shown.includes('white-space: nowrap') && shown.includes('text-overflow: clip'), 'the empty box stays one line and clips without dots (typed words wrap)');
  // 23 Nov 2026, design-language pass: the notes-wide hint is shortened to "Ask about your notes…" so it fits the
  // side column whole (the longer one was cut mid-word), and the title says the longer words; every other hint is
  // its own title as before. So the title is boxTitle, which falls back to the hint itself.
  assert.ok(panel.includes('placeholder={boxHint}') && panel.includes('title={boxTitle}'), 'the box carries its full hint as its title');
  assert.ok(/const boxTitle = boxHint === 'Ask about your notes…' \? 'Ask about your notes, or ask for something done' : boxHint;/.test(panel), 'the title is the hint, or the longer words for the short notes-wide hint');
  assert.match(css, /\.chat \{[^}]*padding-bottom: 10px/, 'the panel keeps its own bottom padding');
  assert.match(css, /\.chat-modelfoot \{[^}]*margin: 0 10px 0/, 'the foot sits inside it, not on a margin');
  assert.ok(panel.includes('Math.min(160, el.scrollHeight)'), 'the box grows with the words, up to its max');
  assert.match(css, /\.chat-input textarea \{[^}]*max-height: 160px/, 'the max in the sheet too');
  assert.match(css, /\.chat-input textarea \{[^}]*overflow-y: auto/, 'past the max it scrolls inside');
  assert.match(css, /\.chat-input \{[^}]*align-items: flex-end/, 'it grows upward, the buttons staying put');
});

// Round 2 measured: the rectangles at 1219x709, 1440x900, 1920x1117 and the narrowest panel (300).
test('round 2 measured: nothing cut at 1219, 1440, 1920 and the 300 panel', async () => {
  assert.ok(existsSync(SHELL), `no headless Chromium (HEADLESS_SHELL): ${SHELL}`);
  const WebSocket = require('ws');
  const css = stylesheets();
  const dir = mkdtempSync(path.join(tmpdir(), 'nv-one-ask-round2-'));
  // A made-up project with a long name: the hint that wrapped.
  const project = 'Harbour Line Fit-Out (Made-Up Project, North-West)';
  const hint = `Ask about “${project}”…`;
  const scene = (panelWidth) => `<!doctype html>
<html lang="en-AU" data-theme="light" data-palette="bright">
<head><meta charset="utf-8"><style>${css}</style>
<style>html, body { margin: 0; height: 100%; } .app { height: 100vh; display: flex; } .group-body { flex: 1; min-width: 0; display: flex; flex-direction: column; } .nv-page { flex: 1; min-height: 0; }</style>
</head>
<body><div class="app" data-platform="linux"><div class="group-body"><div class="topbar"><div class="view-nav"></div></div><div class="nv-page"></div></div>
<aside class="sidebar right" style="width: ${panelWidth}px" aria-label="Chat"><div class="side-band"></div><div class="side-title"><span>Chat</span></div><div class="side-body"><div class="chat">
<div class="chat-bar"><div class="segmented small"><button>All notes</button><button class="active">This page + linked</button></div></div>
<div class="chat-log"><div class="chat-empty"><div class="chat-empty-title">Ask your notes</div><p class="hint">Answers start.</p></div></div>
<div class="chat-input"><textarea rows="1" placeholder="${hint}" title="${hint}"></textarea><button class="chat-send" aria-label="Send">↑</button></div>
<div class="chat-modelfoot"><button class="chat-model"><span>Recommended</span></button></div>
</div></div></aside></div></body></html>`;
  const files = new Map();
  for (const w of [380, 300]) {
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
    for (const [W, H, P] of [[1219, 709, 380], [1440, 900, 380], [1920, 1117, 380], [1219, 709, 300]]) {
      await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
      await send('Page.navigate', { url: pathToFileURL(files.get(P)).href });
      let ready = false;
      for (let i = 0; i < 60 && !ready; i++) {
        await sleep(150);
        try {
          ready = await ev(`!!document.querySelector('.chat-input textarea')`);
        } catch {}
      }
      assert.ok(ready, `the chat drew at ${W}x${H} panel ${P}`);
      const m = await ev(`(() => {
        const rect = (sel) => { const b = document.querySelector(sel).getBoundingClientRect(); return { top: b.top, bottom: b.bottom, height: b.height }; };
        const ta = document.querySelector('.chat-input textarea');
        return { viewportH: window.innerHeight, chat: rect('.chat'), input: rect('.chat-input'), foot: rect('.chat-modelfoot'), model: rect('.chat-model'), taH: ta.getBoundingClientRect().height, taScrollH: ta.scrollHeight, taClientH: ta.clientHeight, taWhiteSpace: getComputedStyle(ta).whiteSpace, phEllipsis: getComputedStyle(ta, '::placeholder').textOverflow, padBottom: parseFloat(getComputedStyle(document.querySelector('.chat')).paddingBottom) || 0 };
      })()`);
      assert.ok(m.taScrollH <= m.taClientH + 2, `${W}x${H} panel ${P}: the hint stays one line, none clipped (scroll ${m.taScrollH}px in ${m.taClientH}px)`);
      assert.equal(m.taWhiteSpace, 'nowrap', `${W}x${H} panel ${P}: the empty box stays one line`);
      assert.equal(m.phEllipsis, 'clip', `${W}x${H} panel ${P}: the long hint clips without dots (t207 pass 2)`);
      assert.ok(m.padBottom >= 10, `${W}x${H} panel ${P}: the panel keeps its bottom padding (${m.padBottom}px)`);
      assert.ok(m.foot.bottom <= m.chat.bottom - m.padBottom + 1, `${W}x${H} panel ${P}: the foot sits inside (${m.foot.bottom.toFixed(1)} in ${m.chat.bottom.toFixed(1)} less ${m.padBottom}px)`);
      assert.ok(m.model.bottom <= m.viewportH + 0.5 && m.model.bottom <= m.chat.bottom + 0.5, `${W}x${H} panel ${P}: the picker shows whole (${m.model.bottom.toFixed(1)} in ${m.viewportH}px)`);
      // Eight lines grow the box upward; thirty stop at the max and scroll inside.
      const grown = await ev(`(() => {
        const ta = document.querySelector('.chat-input textarea');
        const before = document.querySelector('.chat-input').getBoundingClientRect().top;
        ta.value = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'].join('\\n');
        ta.style.height = '0px';
        ta.style.height = Math.min(160, ta.scrollHeight) + 'px';
        const after = { h: ta.getBoundingClientRect().height, top: document.querySelector('.chat-input').getBoundingClientRect().top, foot: document.querySelector('.chat-modelfoot').getBoundingClientRect().bottom, chat: document.querySelector('.chat').getBoundingClientRect().bottom, pad: parseFloat(getComputedStyle(document.querySelector('.chat')).paddingBottom) || 0 };
        ta.value = Array.from({ length: 30 }, (_, i) => 'line ' + i).join('\\n');
        ta.style.height = '0px';
        ta.style.height = Math.min(160, ta.scrollHeight) + 'px';
        return { before, h8: after.h, top8: after.top, foot8: after.foot, chat8: after.chat, pad8: after.pad, h30: ta.getBoundingClientRect().height, scroll30: ta.scrollHeight, client30: ta.clientHeight };
      })()`);
      assert.ok(grown.h8 > m.taH + 10, `${W}x${H} panel ${P}: eight lines grow the box (${m.taH.toFixed(1)} to ${grown.h8.toFixed(1)}px)`);
      assert.ok(grown.top8 < m.input.top - 5, `${W}x${H} panel ${P}: it grows upward (${m.input.top.toFixed(1)} to ${grown.top8.toFixed(1)}px)`);
      assert.ok(grown.foot8 <= grown.chat8 - grown.pad8 + 1, `${W}x${H} panel ${P}: grown, the foot still sits inside`);
      assert.ok(grown.h30 <= 161, `${W}x${H} panel ${P}: thirty lines stop at the max (${grown.h30.toFixed(1)}px)`);
      assert.ok(grown.scroll30 > grown.client30, `${W}x${H} panel ${P}: past the max it scrolls inside`);
    }
    ws.close();
  } finally {
    child.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});
