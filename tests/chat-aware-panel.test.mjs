// node --test tests/chat-aware-panel.test.mjs — the right column is two tabs, Chat | Note (20 Nov 2026). Chat has the
// whole column to itself; Note holds the outline, connections, links and dates. The saved panel says which tab shows,
// asking from anywhere lands on Chat, the last tab is remembered, and with no AI connection the chat shows one calm
// "Add an AI connection" instead of an error. The assistant itself answers through the models seam with its tools.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
process.env.no_proxy = [process.env.no_proxy, '127.0.0.1,localhost'].filter(Boolean).join(', ');
process.env.NO_PROXY = [process.env.NO_PROXY, '127.0.0.1,localhost'].filter(Boolean).join(', ');
const root = path.join(import.meta.dirname, '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SHELL = process.env.HEADLESS_SHELL || (process.env.HOME || '') + '/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell';
const stylesheets = () => {
  const order = [...read('src/renderer/src/main.tsx').matchAll(/import '\.\/(styles\.css|styles\/[^']+\.css)';/g)].map((m) => m[1]);
  assert.ok(order.length > 10 && order[0] === 'styles.css', `${order.length} stylesheets in the window's order`);
  return [...order, 'styles/search-ask-87.css'].map((f) => `/* ${f} */\n${read(`src/renderer/src/${f}`)}`).join('\n');
};
/** Code without its comments, so a check on the words a person sees isn't answered by a note to a developer. */
const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

let L; // shared/layout-fit.ts
let A; // main/ai.ts
let work;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  work = mkdtempSync(path.join(tmpdir(), 'nv-chat-tabs-'));
  await build({ input: path.join(root, 'src/shared/layout-fit.ts'), platform: 'node', output: { file: path.join(work, 'layout-fit.mjs'), format: 'esm' }, logLevel: 'silent' });
  L = await import(pathToFileURL(path.join(work, 'layout-fit.mjs')).href);
  await build({ input: path.join(root, 'src/main/ai.ts'), platform: 'node', external: [/^node:/], output: { file: path.join(work, 'ai.mjs'), format: 'esm' }, logLevel: 'silent' });
  A = await import(pathToFileURL(path.join(work, 'ai.mjs')).href);
});
after(() => {
  if (work) rmSync(work, { recursive: true, force: true });
});

test('the saved panel says which tab shows: chat is Chat, every note panel is Note', () => {
  assert.equal(L.rightTabOf('chat', true), 'chat');
  for (const panel of ['outline', 'local-graph', 'autolink', 'backlinks', 'outgoing', 'related']) assert.equal(L.rightTabOf(panel, true), 'note', panel);
  assert.equal(L.rightTabOf('outline', false), 'chat', 'off a note there is only the chat');
  assert.equal(L.rightTabOf('chat', false), 'chat');
});

test('a tab’s click lands on the chat, or on the note panel last on show', () => {
  assert.equal(L.panelForRightTab('chat', 'autolink'), 'chat');
  assert.equal(L.panelForRightTab('note', 'autolink'), 'autolink', 'the Note tab comes back where it was left');
  assert.equal(L.panelForRightTab('note', 'local-graph'), 'local-graph');
  assert.equal(L.panelForRightTab('note', 'chat'), 'outline', 'never the chat under the Note tab');
  assert.equal(L.panelForRightTab('note', 'nonsense'), 'outline');
});

test('the right side is one tab strip, with the chat on its own and the note panes together', () => {
  const side = read('src/renderer/src/panels/Sidebars.tsx');
  assert.match(side, /role="tablist"/, 'a real tab strip');
  assert.match(side, /\{ id: 'chat', label: 'Chat'/);
  assert.match(side, /\{ id: 'note', label: 'Note'/);
  assert.match(side, /rightTabOf\(panel, !!notePath\)/, 'driven by the saved panel (ws.right.panel)');
  assert.equal(side.split('<ChatPanel').length - 1, 1, 'one chat panel, never a second copy in a stack');
  const chatAt = side.indexOf('<ChatPanel');
  const stacksAt = side.indexOf('side-body is-stacks');
  assert.ok(chatAt > 0 && stacksAt > chatAt, 'the chat sits in its own tab panel, outside the note’s stacks');
  const stacks = side.slice(stacksAt);
  for (const pane of ['<OutlinePanel', '<LocalGraphPanel', '<OutgoingPanel', '<LinksPanel', '<TagsDates']) assert.ok(stacks.includes(pane), `${pane} is on the Note tab`);
  assert.ok(!stacks.includes('<ChatPanel'), 'no chat among the note panes');
  assert.match(side, /hidden=\{shown !== 'chat'\}/, 'the chat stays mounted behind the Note tab, so a half-typed question survives');
  assert.match(side, /disabled: !notePath/, 'the Note tab is off while no note is open');
});

test('the stacked chat and its height cap are gone', () => {
  for (const file of ['src/renderer/src/panels/Sidebars.tsx', 'src/renderer/src/styles.css']) assert.ok(!read(file).includes('side-stack-chat'), `${file} has no .side-stack-chat`);
  const css = read('src/renderer/src/styles.css');
  assert.match(css, /\.rside-tabs \{/);
  assert.match(css, /\.rside-tab\.is-on \{/);
  assert.doesNotMatch(css, /clamp\(300px, 44vh, 460px\)/, 'the chat is never capped to part of the column');
});

test('asking from anywhere switches to Chat, and the tab is remembered', () => {
  const chat = read('src/renderer/src/state/chat.ts');
  const ask = chat.slice(chat.indexOf('export function askInChat'), chat.indexOf('export function draftInChat'));
  assert.match(ask, /showSide\('right', 'chat'\)/, 'Ask opens the right side on the chat');
  const draft = chat.slice(chat.indexOf('export function draftInChat'), chat.indexOf('export async function addChatFolder'));
  assert.match(draft, /showSide\('right', 'chat'\)/, 'a drafted question opens it too');
  const fit = read('src/renderer/src/state/fit.ts');
  assert.match(fit, /showSide\('right', 'chat'\)/, 'Ctrl+J and the header’s Ask');
  assert.match(read('src/renderer/src/state/workspace.ts'), /right: \{ open: boolean; width: number; panel: RightPanel \}/, 'the panel is part of the saved workspace, so the last tab comes back');
  assert.match(read('src/renderer/src/state/commands.ts'), /id: 'chat', name: 'Chat with your notes'.*setPanel\('right', 'chat'\)/);
});

test('with no AI connection every ask lands on one calm state, never an error', () => {
  const chat = read('src/renderer/src/state/chat.ts');
  assert.match(chat, /if \(!aiReady\(\)\) return draftInChat\(text, note\);/, 'Ask keeps the words and opens the panel');
  const send = chat.slice(chat.indexOf('export async function sendChat'));
  assert.ok(send.indexOf('if (!aiReady())') > 0 && send.indexOf('if (!aiReady())') < send.indexOf('window.nv.ai.chat') || !send.includes('window.nv.ai.chat'), 'nothing is sent before a connection is there');
  const setup = read('src/renderer/src/components/AiSetup.tsx');
  assert.match(setup, /AI_SETUP_TITLE = 'Add an AI connection'/);
  assert.match(setup, /openModal\(\{ kind: 'settings', section: 'models' \}\)/, 'its button opens Settings › AI');
  const panel = read('src/renderer/src/panels/ChatPanel.tsx');
  assert.match(panel, /\{notReady && <AiSetup why=\{settings\.ai\.note\} \/>\}/, 'the chat shows it');
  assert.match(read('src/renderer/src/components/LinksPanel.tsx'), /<AiSetup compact why=\{aiNote\} \/>/, 'suggested links show it');
  assert.match(read('src/main/providers/index.ts'), /NO_CONNECTION = 'Add an AI connection in Settings › AI to use this\.'/);
});

test('Settings › AI: connections, key, test, models, default model, transcription and the privacy line', () => {
  const ai = read('src/renderer/src/components/AiSettings.tsx');
  assert.match(ai, /Requests go straight from this PC to the provider you choose\. Nothing is sent until you add a connection\./);
  for (const kind of ['anthropic', 'openai', 'google', 'ollama', 'custom']) assert.ok(ai.includes(`kind: '${kind}'`), `the ${kind} preset`);
  assert.match(ai, /type="password"/, 'the key is masked');
  for (const call of ['models.addConnection', 'models.removeConnection', 'models.setKey', 'models.listRemote', 'models.test', 'models.setTranscription', 'settings.update({ model })']) assert.ok(ai.includes(call), call);
  const settings = read('src/renderer/src/components/Settings.tsx');
  assert.match(settings, /\{current === 'models' && <AiSettings prefs=\{prefs\} set=\{set\} \/>\}/, 'mounted from Settings');
  assert.match(read('src/renderer/src/lib/settingsSearch.ts'), /\{ id: 'models', label: 'AI'/);
  const preload = read('src/preload/index.ts');
  for (const channel of ['models:view', 'models:add-connection', 'models:remove-connection', 'models:set-key', 'models:list-remote', 'models:test', 'models:set-transcription']) {
    assert.ok(preload.includes(`'${channel}'`), `${channel} in the preload`);
    assert.ok(read('src/main/app.ts').includes(`handle('${channel}'`), `${channel} handled`);
  }
});

test('nothing a person reads in the AI screens names another app', () => {
  for (const file of ['src/renderer/src/panels/ChatPanel.tsx', 'src/renderer/src/panels/Sidebars.tsx', 'src/renderer/src/components/AiSettings.tsx', 'src/renderer/src/components/AiSetup.tsx', 'src/renderer/src/components/LinksPanel.tsx', 'src/renderer/src/components/ScopedAsk.tsx', 'src/renderer/src/state/chat.ts', 'src/main/providers/index.ts', 'src/main/providers/connections.ts', 'src/main/ai.ts']) {
    assert.doesNotMatch(code(read(file)), /NeuralSpark/, `${file} names the old host app to a person`);
  }
  assert.ok(!existsSync(path.join(root, 'src/renderer/src/panels/ChatJobs.tsx')), 'no card for work handed to another app');
  const agent = code(read('src/main/agent.ts'));
  assert.doesNotMatch(agent, /NeuralSpark/, 'the assistant’s instructions and tools name no other app');
  assert.doesNotMatch(agent, /hand_to_neuralspark/, 'and offer no hand-over tool');
});

/** An AiService on a stand-in notes model and a stand-in for the person's connection: what each ask sent. */
function standAnswer(replyText = 'An answer from your notes.') {
  const sent = [];
  const settings = { raw: { model: { provider: 'conn-1', model: 'model-1' } } };
  const index = { retrieve: () => [], get: () => undefined, content: () => '' };
  const providers = {
    view: () => ({ connections: [{ id: 'conn-1', name: 'My connection', kind: 'custom', models: [{ id: 'model-1', name: 'Model 1' }] }], transcription: null }),
    effectiveChoice: (c) => c ?? { provider: 'conn-1', model: 'model-1' },
    stream: async (choice, system, messages, opts) => {
      sent.push({ choice, system, messages, opts });
      opts.onText?.(replyText);
      return { text: replyText, stopReason: 'stop' };
    },
  };
  const ai = new A.AiService(settings, index, providers);
  ai.agentHost = { today: () => 'Today is Monday.' };
  return { ai, sent };
}

test('the assistant answers through the models seam, with its tools, on the model the person chose', async () => {
  const { ai, sent } = standAnswer();
  let streamed = '';
  const r = await ai.chat([{ role: 'user', content: 'What do my notes say?' }], (t) => (streamed += t), new AbortController().signal, { scope: 'all' });
  assert.equal(r.text, 'An answer from your notes.', r.error);
  assert.ok(streamed.includes('An answer from your notes.'), 'the words arrive as they stream');
  assert.ok(sent.length >= 1 && Array.isArray(sent[0].opts.tools) && sent[0].opts.tools.length > 0, 'asked with its tools');
  assert.deepEqual(sent[0].choice, { provider: 'conn-1', model: 'model-1' });
  assert.doesNotMatch(sent[0].system, /NeuralSpark/, 'its instructions name no other app');
  assert.ok(!sent[0].opts.tools.some((t) => t.name === 'hand_to_neuralspark'), 'no hand-over tool is offered');
  assert.ok(!sent[0].opts.tools.some((t) => t.name === 'web_search'), 'no web tool is offered where none is wired');
});

test('measured: the chat fills the whole column under the tabs, at every panel width', async () => {
  assert.ok(existsSync(SHELL), `no headless Chromium (HEADLESS_SHELL): ${SHELL}`);
  const WebSocket = require('ws');
  const css = stylesheets();
  const svg = (s) => `<svg width="${s}" height="${s}"></svg>`;
  // The scene mirrors panels/Sidebars.tsx on the Chat tab (same classes, same order).
  const scene = (panelWidth) => `<!doctype html>
<html lang="en-AU" data-theme="light" data-palette="bright">
<head><meta charset="utf-8"><style>${css}</style>
<style>html, body { margin: 0; height: 100%; } .app { height: 100vh; display: flex; justify-content: flex-end; }</style>
</head>
<body><div class="app" data-platform="linux">
<aside class="sidebar right" style="width: ${panelWidth}px" aria-label="Chat with your notes">
<div class="side-band drag controls-gap"><button class="side-toggle">${svg(16)}</button><div class="rside-tabs" role="tablist"><button role="tab" aria-selected="true" class="rside-tab is-on">Chat</button><button role="tab" aria-selected="false" class="rside-tab">Note</button></div></div>
<div class="side-body side-tabpanel-chat" role="tabpanel"><div class="chat">
<div class="chat-bar"><div class="segmented small"><button class="active">All notes</button><button>This page + linked</button></div><button class="icon-button small" title="New chat">${svg(14)}</button></div>
<div class="chat-log"><div class="chat-turn user"><p>What is still open before Friday?</p></div></div>
<div class="chat-input"><textarea rows="1" placeholder="Ask about your notes…"></textarea></div>
<div class="chat-modelfoot"><button class="chat-model">${svg(14)}<span>Recommended</span>${svg(12)}</button></div>
</div></div></aside></div></body></html>`;
  const dir = mkdtempSync(path.join(tmpdir(), 'nv-chat-tabs-scene-'));
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
    ws.on('message', (raw) => {
      const m = JSON.parse(String(raw));
      if (m.id && pending.has(m.id)) {
        const [resolve, reject] = pending.get(m.id);
        pending.delete(m.id);
        if (m.error) reject(new Error(m.error.message));
        else resolve(m.result);
      }
    });
    const send = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const msgId = ++id;
        pending.set(msgId, [resolve, reject]);
        ws.send(JSON.stringify({ id: msgId, method, params }));
      });
    for (const [vw, vh] of [[1366, 768], [1920, 1080], [3456, 1408]]) {
      await send('Emulation.setDeviceMetricsOverride', { width: vw, height: vh, deviceScaleFactor: 1, mobile: false });
      for (const w of [300, 380, 640]) {
        const file = path.join(dir, `chat-${w}.html`);
        writeFileSync(file, scene(w));
        await send('Page.navigate', { url: pathToFileURL(file).href });
        await sleep(350);
        const m = await send('Runtime.evaluate', {
          returnByValue: true,
          expression: `(() => {
          const r = (s) => document.querySelector(s).getBoundingClientRect();
          const panel = r('.sidebar.right'), band = r('.side-band'), chat = r('.chat'), tabs = r('.rside-tabs'), input = r('.chat-input'), foot = r('.chat-modelfoot');
          const tabRects = [...document.querySelectorAll('.rside-tab')].map((b) => b.getBoundingClientRect());
          return {
            chatTop: chat.top, chatBottom: chat.bottom, bandBottom: band.bottom, panelBottom: panel.bottom, vh: innerHeight,
            tabsInside: tabs.left >= panel.left - 1 && tabs.right <= panel.right + 1 && tabs.top >= band.top - 1 && tabs.bottom <= band.bottom + 1,
            tabsWhole: [...document.querySelectorAll('.rside-tab')].every((b) => b.scrollWidth <= Math.ceil(b.getBoundingClientRect().width) + 1),
            tabsApart: tabRects.length === 2 && tabRects[0].right <= tabRects[1].left + 1,
            composerAtFoot: panel.bottom - Math.max(input.bottom, foot.bottom) < 24,
            boxes: document.querySelectorAll('.chat textarea').length,
          };
        })()`,
        });
        const v = m.result.value;
        const at = `${vw}x${vh} panel ${w}`;
        assert.ok(Math.abs(v.chatTop - v.bandBottom) <= 2, `${at}: the chat starts right under the tabs (${v.chatTop} vs ${v.bandBottom})`);
        assert.ok(v.vh - v.chatBottom <= 2, `${at}: the chat runs to the bottom of the column (${v.chatBottom} of ${v.vh})`);
        assert.ok(v.chatBottom - v.chatTop >= v.vh - v.bandBottom - 4, `${at}: the chat has the full column height`);
        assert.ok(v.tabsInside, `${at}: the tabs sit inside the band`);
        assert.ok(v.tabsWhole && v.tabsApart, `${at}: both tab names read whole, side by side`);
        assert.ok(v.composerAtFoot, `${at}: the message box sits at the foot of the column`);
        assert.equal(v.boxes, 1, `${at}: one message box`);
      }
    }
    ws.close();
  } finally {
    child.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});
