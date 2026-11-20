// node --test tests/split-focus-panel.test.mjs — one product step 5 part 3 (8 Nov 2026): the right
// chat panel follows the focused side. The former host app's window tells the view whether the main
// area is split and which side has focus; the panel re-scopes at once: "About this note: <title>"
// answering about the note while a note has focus, its own chat ("All notes") while a chat does. Each
// side's half-typed question is kept, in the one panel with the one chat box. With no split
// everything reads as today.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
process.env.no_proxy = [process.env.no_proxy, '127.0.0.1,localhost'].filter(Boolean).join(',');
process.env.NO_PROXY = [process.env.NO_PROXY, '127.0.0.1,localhost'].filter(Boolean).join(',');
const root = path.join(import.meta.dirname, '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SHELL = process.env.HEADLESS_SHELL || (process.env.HOME || '') + '/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell';
// The window's stylesheets in the order it loads them (main.tsx), plus the chat panel's own sheet (imported by
// panels/ChatPanel.tsx, where the scope line's rules live), so the cascade is the window's.
const stylesheets = () => {
  const order = [...read('src/renderer/src/main.tsx').matchAll(/import '\.\/(styles\.css|styles\/[^']+\.css)';/g)].map((m) => m[1]);
  assert.ok(order.length > 10 && order[0] === 'styles.css', `${order.length} stylesheets in the window's order`);
  return [...order, 'styles/search-ask-87.css'].map((f) => `/* ${f} */\n${read(`src/renderer/src/${f}`)}`).join('\n');
};

// The split focus as pure logic: bundled from the shared source, so the checks run the real words.
let S;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const work = (globalThis.__splitFocusWork ??= mkdtempSync(path.join(tmpdir(), 'nv-split-focus-')));
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/shared/split-focus.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'split-focus.mjs'), format: 'esm' }, logLevel: 'silent' });
  S = await import(pathToFileURL(path.join(work, 'split-focus.mjs')).href);
});
after(() => {
  if (globalThis.__splitFocusWork) rmSync(globalThis.__splitFocusWork, { recursive: true, force: true });
});

test('the told focus coerces to split or not, chat or note, nothing else', () => {
  assert.deepEqual(S.coerceSplitFocus({ split: true, focus: 'chat' }), { split: true, focus: 'chat' });
  assert.deepEqual(S.coerceSplitFocus({ split: true, focus: 'note' }), { split: true, focus: 'note' });
  assert.deepEqual(S.coerceSplitFocus({}), { split: false, focus: 'note' });
  assert.deepEqual(S.coerceSplitFocus(null), { split: false, focus: 'note' });
  assert.deepEqual(S.coerceSplitFocus(undefined), { split: false, focus: 'note' });
  assert.deepEqual(S.coerceSplitFocus('split'), { split: false, focus: 'note' });
  assert.deepEqual(S.coerceSplitFocus({ split: 1, focus: 'chat' }), { split: false, focus: 'chat' });
  assert.deepEqual(S.coerceSplitFocus({ split: true, focus: 'CHAT' }), { split: true, focus: 'note' });
});

test('the scope follows the focused side: the note, or the chat’s own', () => {
  assert.equal(S.splitScopeFor({ split: true, focus: 'note' }, true), 'note');
  assert.equal(S.splitScopeFor({ split: true, focus: 'note' }, false), 'all');
  // Part 4: a focused chat scopes to that chat (About this chat), answering from its transcript.
  assert.equal(S.splitScopeFor({ split: true, focus: 'chat' }, true), 'chat');
  assert.equal(S.splitScopeFor({ split: true, focus: 'chat' }, false), 'chat');
  assert.equal(S.splitScopeFor({ split: false, focus: 'note' }, true), null);
  assert.equal(S.splitScopeFor({ split: false, focus: 'chat' }, true), null);
});

test('the scope reads About this note, or All notes as the chat’s own does today', () => {
  assert.equal(S.splitScopeWords('note', 'Daylesford Cabin tile shortlist'), 'About this note: Daylesford Cabin tile shortlist');
  assert.equal(S.splitScopeWords('note', ''), 'About this note');
  assert.equal(S.splitScopeWords('all', 'Daylesford Cabin tile shortlist'), 'All notes');
  assert.equal(S.splitScopeWords('all', ''), 'All notes');
});

test('the view is told the focus through the same seam as its notes', () => {
  const app = read('src/main/app.ts');
  assert.ok(app.includes('splitFocus('), 'Ironleaf tells its view the split focus');
  assert.ok(app.includes("sendToView('vault:split-focus'"), 'to the view alone, never the window');
  const preload = read('src/preload/index.ts');
  assert.ok(preload.includes('splitFocus:') && preload.includes("'vault:split-focus'"), 'the page hears it on its own channel');
  const frame = read('src/renderer/src/App.tsx');
  assert.ok(frame.includes('on.splitFocus') && frame.includes('setSplitFocus'), 'the frame keeps it where the panel reads it');
  const store = read('src/renderer/src/state/splitFocus.ts');
  assert.ok(store.includes('coerceSplitFocus') && store.includes('useSplitFocus'), 'kept coerced, read live');
});

test('a restart with a split re-tells the focus once the view reports its tabs', () => {
  const app = read('src/main/app.ts');
  const at = app.indexOf('function tabsReport');
  assert.ok(at > 0, 'the view reports its tabs for the one strip');
  const body = app.slice(at, at + 2500);
  assert.ok(body.includes('vault:split-focus') || body.includes('toldFocus'), 're-telling the split focus with the tabs, so a restarted split lands scoped');
});

test('the panel re-scopes at once, keeps each side’s question, and stays one panel', () => {
  const panel = read('src/renderer/src/panels/ChatPanel.tsx');
  assert.ok(panel.includes('useSplitFocus'), 'the panel reads the told focus');
  assert.ok(panel.includes('splitScopeFor') && panel.includes('setChatScope'), 'and its scope follows at once');
  assert.ok(panel.includes('splitScopeWords') && panel.includes('chat-scope-line'), 'reading About this note, or All notes');
  assert.ok(panel.includes('This page + linked'), 'the scope buttons stay for the window as today');
  assert.ok(panel.includes('sendChat(question, note'), 'asking about the note goes through the note scope as today');
  // Each side's half-typed question kept across switches, in the one box: stashed per scope, not a second input.
  assert.ok(/splitDrafts|draftsRef|draftFor/i.test(panel), 'a half-typed question is kept per scope');
  assert.equal((panel.match(/<textarea/g) || []).length, 1, 'one chat box, never a second');
});

test('the scope line sits in the one top row, in theme tokens, light first', () => {
  const css = read('src/renderer/src/styles/search-ask-87.css');
  const rule = css.match(/\.chat \.chat-scope-line \{([^}]*)\}/s)?.[1] ?? assert.fail('no scope-line rule in the panel’s sheet');
  assert.ok(rule.includes('flex: 1'), 'it stretches the one top row beside New chat, as the scope did');
  assert.ok(!/jell|#(?:[0-9a-f]{3}|[0-9a-f]{6})\b/i.test(rule.replace(/var\(--[a-z-]+\)/gi, '')), 'colours only from the theme tokens');
});

// Measured: the scope line reads whole at the panel widths (300 least, 380 usual, 640 most), beside New chat,
// above the one chat box — with a long note title, nothing cut off and nothing running past the panel.
test('measured: the scope line fits at every panel width, with the one chat box beneath', async () => {
  assert.ok(existsSync(SHELL), `no headless Chromium (HEADLESS_SHELL): ${SHELL}`);
  const WebSocket = require('ws');
  const css = stylesheets();
  const svg = (s) => `<svg width="${s}" height="${s}"></svg>`;
  const scene = (panelWidth, scope) => `<!doctype html>
<html lang="en-AU" data-theme="light" data-palette="bright">
<head><meta charset="utf-8"><style>${css}</style>
<style>html, body { margin: 0; height: 100%; } .app { height: 100vh; display: flex; }</style>
</head>
<body><div class="app" data-platform="linux">
<aside class="sidebar right" style="width: ${panelWidth}px" aria-label="Chat"><div class="side-band"></div><div class="side-body"><div class="chat">
<div class="chat-bar"><div class="chat-scope-line" title="${scope}">${scope}</div><button class="icon-button small" title="New chat">${svg(14)}</button></div>
<div class="chat-log"><div class="chat-turn user"><p>What is still undecided on this note?</p></div></div>
<div class="chat-input"><textarea rows="1" placeholder="Ask about your notes…"></textarea></div>
<div class="chat-modelfoot"><button class="chat-model">${svg(14)}<span>Recommended</span>${svg(12)}</button></div>
</div></div></aside></div></body></html>`;
  const dir = mkdtempSync(path.join(tmpdir(), 'nv-split-focus-'));
  try {
    const scopes = {
      note: 'About this note: Daylesford Cabin tile shortlist for the upstairs bathroom and laundry',
      chat: 'All notes',
    };
    const files = [];
    for (const w of [300, 380, 640]) for (const k of ['note', 'chat']) {
      const file = path.join(dir, `scope-${k}-${w}.html`);
      writeFileSync(file, scene(w, scopes[k]));
      files.push([k, w, file]);
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
        await sleep(100);
        try {
          const res = await fetch(`http://127.0.0.1:${port}/json/list`);
          const list = await res.json();
          target = list.find((t) => t.type === 'page');
        } catch {}
      }
      assert.ok(target, 'a page to drive');
      const ws = new WebSocket(target.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
      await new Promise((resolve, reject) => {
        ws.once('open', resolve);
        ws.once('error', reject);
      });
      let id = 0;
      const pending = new Map();
      ws.on('message', (raw) => {
        const m = JSON.parse(String(raw));
        if (m.id && pending.has(m.id)) {
          const [resolve, reject] = pending.get(m.id);
          pending.delete(m.id);
          if (m.error) reject(new Error(m.error.message));
          else resolve(m.result);
        }
      });
      const send = (method, params = {}) => new Promise((resolve, reject) => {
        const msgId = ++id;
        pending.set(msgId, [resolve, reject]);
        ws.send(JSON.stringify({ id: msgId, method, params }));
      });
      for (const [k, w, file] of files) {
        await send('Page.navigate', { url: pathToFileURL(file).href });
        await sleep(400);
        const m = await send('Runtime.evaluate', { returnByValue: true, expression: `(() => {
          const line = document.querySelector('.chat-scope-line');
          const bar = document.querySelector('.chat-bar');
          const panel = document.querySelector('.sidebar.right');
          const lr = line.getBoundingClientRect(), br = bar.getBoundingClientRect(), pr = panel.getBoundingClientRect();
          return {
            words: line.textContent,
            boxes: document.querySelectorAll('.chat textarea').length,
            lineFits: lr.left >= pr.left - 1 && lr.right <= pr.right + 1,
            barTop: Math.round(br.top),
            lineClipped: line.scrollWidth > Math.ceil(lr.width) + 1,
            panelW: Math.round(pr.width),
          };
        })()` });
        const v = m.result.value;
        assert.equal(v.words, scopes[k], `the ${k} scope reads whole at ${w}px`);
        assert.equal(v.boxes, 1, `one chat box beneath the ${k} scope at ${w}px`);
        assert.ok(v.lineFits, `the ${k} scope stays inside the panel at ${w}px`);
        assert.ok(!v.lineClipped, `the ${k} scope is never cut off at ${w}px (${scopes[k]})`);
      }
      ws.close();
    } finally {
      child.kill();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
