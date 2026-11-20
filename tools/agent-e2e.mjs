// The chat's assistant end to end in the BUILT Ironleaf, driven as a person would (keys and clicks over the DevTools
// protocol), with a scripted model on this PC that asks for tools the way a real one does (OpenAI chat completions with
// tool calls, through Ironleaf's own model code). Nothing reaches a real provider.
//   xvfb-run -a -s "-screen 0 1600x1000x24" node tools/agent-e2e.mjs . /path/to/work
// It asks "What have I decided lately?" (the answer must come from the Decision Log, found by searching), then gives it a
// projects folder to take stock of (it reads the folder and sets up one project file per project, docs/PROJECTS-DESIGN.md),
// checks the files on disk and a project's page, asks it to catch a project up (a change to accept: Accept, then Undo),
// presses Undo on the set-up and checks the projects are gone. Screenshots go to <work>/shots; exit code 1 on any failure.
import { spawn } from 'node:child_process';
import { freePort } from './free-port.mjs';
import { createRequire } from 'node:module';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const [project = '.', work = path.join(project, '.agent-e2e')] = process.argv.slice(2);
const notes = path.resolve(work, 'notes');
const userData = path.resolve(work, 'userdata');
const shots = path.resolve(work, 'shots');
const projects = path.resolve(work, 'projects');
rmSync(work, { recursive: true, force: true });
for (const d of [userData, shots]) mkdirSync(d, { recursive: true });
cpSync(path.join(project, 'tools', 'review-notes'), notes, { recursive: true });
mkdirSync(path.join(notes, 'Decisions'), { recursive: true });
writeFileSync(path.join(notes, 'Decisions', 'Decision Log.md'), '# Decision Log\n\n- 2026-10-12 Chose Western Plains Mill for flour: steadier price than the co-op.\n- 2026-10-14 Moved Saturday opening to 7 am.\n');
// A made-up projects folder, as a person keeps one.
for (const [rel, text] of [
  ['harbour-cafe/README.md', '# Harbour Cafe bookings\nTable bookings for the cafe on the wharf. Status: live since August.'],
  ['harbour-cafe/package.json', '{"name":"harbour-cafe","version":"1.4.0"}'],
  ['bakery-site/README.md', '# Saltwater Bakehouse website\nThe bakery’s site. Next: the winter menu page.'],
  ['bakery-site/node_modules/x/index.js', 'module.exports = 1'],
]) {
  mkdirSync(path.dirname(path.join(projects, rel)), { recursive: true });
  writeFileSync(path.join(projects, rel), text);
}

// The scripted model: it reads where the conversation is and asks for the next tool, as a capable model would.
const requests = [];
function chunks(res, parts) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  const base = { id: 'c1', object: 'chat.completion.chunk', created: 1, model: 'scripted' };
  for (const p of parts) res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: p.delta ?? {}, finish_reason: p.finish ?? null }] })}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
}
const say = (res, text) => chunks(res, [{ delta: { role: 'assistant', content: text } }, { finish: 'stop' }]);
let callNo = 0;
const ask = (res, text, calls) =>
  chunks(res, [
    ...(text ? [{ delta: { role: 'assistant', content: text } }] : []),
    ...calls.map((c, i) => ({ delta: { ...(text || i ? {} : { role: 'assistant' }), tool_calls: [{ index: i, id: `call_${++callNo}`, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } }] } })),
    { finish: 'tool_calls' },
  ]);
const HARBOUR = { name: 'Harbour Cafe bookings', folder: path.join(projects, 'harbour-cafe'), status: 'active', health: 'on track', summary: 'Table bookings for the cafe on the wharf. Live since August (version 1.4.0), a Node app.', documents: [{ path: 'README.md', what: 'what it is' }], next: [{ what: 'Check the bookings still close at 8 pm' }] };
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const json = JSON.parse(body || '{}');
    requests.push(json);
    const msgs = json.messages ?? [];
    const lastUser = [...msgs].reverse().find((m) => m.role === 'user');
    const userText = typeof lastUser?.content === 'string' ? lastUser.content : (lastUser?.content ?? []).map((c) => c.text ?? '').join('');
    const after = msgs.slice(msgs.lastIndexOf(lastUser) + 1);
    const done = after.filter((m) => m.role === 'tool').map((m) => (typeof m.content === 'string' ? m.content : (m.content ?? []).map((c) => c.text ?? '').join('')));
    if (!json.tools?.length) return say(res, 'No tools were offered.');
    if (/decided/i.test(userText)) {
      if (done.length === 0) return ask(res, 'Let me look through your notes.', [{ name: 'search_notes', args: { query: 'decided' } }]);
      if (done.length === 1) return ask(res, '', [{ name: 'search_notes', args: { query: 'chose' } }]);
      if (done.length === 2) return ask(res, '', [{ name: 'read_note', args: { path: 'Decisions/Decision Log.md' } }]);
      return say(res, 'Two decisions lately, both in [[Decision Log]]:\n\n- **12 Oct**: flour from Western Plains Mill (a steadier price).\n- **14 Oct**: Saturday opening moved to 7 am.');
    }
    if (/take stock/i.test(userText)) {
      if (done.length === 0) return ask(res, 'I’ll look at the folder first.', [{ name: 'notes_overview', args: {} }, { name: 'list_pc_folder', args: { path: projects, depth: 2 } }]);
      if (done.length === 2) return ask(res, '', [{ name: 'read_pc_file', args: { path: path.join(projects, 'harbour-cafe', 'README.md') } }, { name: 'read_pc_file', args: { path: path.join(projects, 'bakery-site', 'README.md') } }]);
      if (done.length === 4)
        return ask(res, 'Setting up each project.', [
          { name: 'save_project', args: HARBOUR },
          { name: 'save_project', args: { name: 'Saltwater Bakehouse website', folder: path.join(projects, 'bakery-site'), status: 'active', summary: 'The bakery’s website.', next: [{ what: 'The winter menu page' }] } },
        ]);
      return say(res, 'Done. Two projects set up: [[Harbour Cafe bookings]] and [[Saltwater Bakehouse website]].');
    }
    if (/catch up/i.test(userText)) {
      if (done.length === 0) return ask(res, 'Looking at what changed.', [{ name: 'save_project', args: { ...HARBOUR, health: 'at risk', next: [...HARBOUR.next, { what: 'Call the kitchen about winter hours', who: 'Sam' }], mode: 'propose' } }]);
      return say(res, 'One change to accept for Harbour Cafe bookings: it is at risk until winter hours are settled.');
    }
    return say(res, 'I can help with that.');
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const modelPort = server.address().port;

// The former host app's profile as 4.x writes it, with one local connection (no key) as the
// default.
const nsUserData = path.resolve(work, 'host-app');
const patchDir = path.join(nsUserData, 'HostApp', 'RuntimeNativePreview', 'profiles', 'host-native');
mkdirSync(patchDir, { recursive: true });
writeFileSync(
  path.join(patchDir, 'cordis.patch.yml'),
  `- id: llm-pi-ai
  name: '@host-app/harness-llm-pi-ai'
  config:
    providers:
      model-local:
        displayName: Scripted model
        baseURL: http://127.0.0.1:${modelPort}/v1
        api: openai-completions
        noAuth: true
        retryPolicy: { mode: normal, maxRetries: 0 }
        models: [ { id: scripted, name: Scripted, contextWindow: 65536, maxTokens: 4096 } ]
- id: agent-default-model
  name: '@host-app/harness-agent-default-model'
  config: { provider: model-local, model: scripted }
`,
);
writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ lastVault: notes, library: notes, recentVaults: [notes] }));

const env = { ...process.env, NV_LICENSE_ORIGIN: 'http://127.0.0.1:9', NS_USER_DATA: nsUserData };
delete env.ELECTRON_RENDERER_URL;
const electron = createRequire(path.resolve(project, 'package.json'))('electron');
const port = await freePort(process.env.SHOT_PORT);
const child = spawn(electron, ['.', '--no-sandbox', `--remote-debugging-port=${port}`, `--user-data-dir=${userData}`], { cwd: project, env, stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
let nextId = 1;
const pending = new Map();
const errors = [];
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const send = (method, params = {}) => new Promise((resolve) => { const id = nextId++; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.value;
const waitFor = async (e, t = 15000) => { const end = Date.now() + t; while (Date.now() < end) { try { if (await ev(e)) return true; } catch {} await sleep(150); } return false; };
const shot = async (name) => { await sleep(500); const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(path.join(shots, `${name}.png`), Buffer.from(r.data, 'base64')); console.log('shot', name); };
const click = async (sel) => {
  const pt = await ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
  if (!pt) throw new Error(`Nothing matches ${sel}`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt[0], y: pt[1], button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt[0], y: pt[1], button: 'left', clickCount: 1 });
};
const enter = async () => {
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await send('Input.dispatchKeyEvent', { type: 'char', key: 'Enter', text: '\r' });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
};
const askChat = async (text) => {
  await click('.chat-input textarea');
  await send('Input.insertText', { text });
  await enter();
  return waitFor(`(() => { const t = [...document.querySelectorAll('.chat-turn.assistant')].at(-1); return !!t && !t.querySelector('.chat-thinking') && !document.querySelector('.chat-send.stop'); })()`, 30000);
};
let failed = false;
try {
  let t;
  for (let i = 0; i < 120 && !t; i++) {
    await sleep(250);
    try { t = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((x) => x.type === 'page'); } catch {}
  }
  ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d.result); pending.delete(d.id); }
    if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails?.exception?.description ?? 'exception');
  };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  check('the notes open', await waitFor(`!!document.querySelector('.tree-file')`, 20000));
  // The chat on the right.
  await ev(`document.querySelector('.side-tab[title="Chat with your notes"]')?.click()`);
  check('the chat is ready on the scripted model', await waitFor(`!!document.querySelector('.chat-input textarea:not(:disabled)') && /Scripted/.test(document.querySelector('.chat-model')?.textContent || '')`, 20000));
  await shot('40-chat-empty');

  // 1. A question about the notes: found by searching (a different word first), with the note linked.
  check('the answer finished', await askChat('What have I decided lately?'));
  const first = await ev(`(() => { const t = [...document.querySelectorAll('.chat-turn.assistant')].at(-1); return { text: t.querySelector('.chat-answer')?.textContent || '', steps: t.querySelector('.chat-steps-toggle')?.textContent || '', from: [...t.querySelectorAll('.chat-sources .chat-source')].map((b) => b.textContent), error: t.querySelector('.chat-error')?.textContent || '' }; })()`);
  check('it answers from the Decision Log', /Western Plains Mill/.test(first.text) && /7 am/.test(first.text), JSON.stringify(first).slice(0, 200));
  check('its steps fold into one line', /3 steps/.test(first.steps), first.steps);
  check('the note it read is listed under From', first.from.includes('Decision Log'), first.from.join(', '));
  check('the tools went to the model', requests.length >= 4 && requests.every((r) => r.tools?.some((x) => x.function?.name === 'search_notes')));
  check('each tool’s answer went back with its call', requests[1].messages.some((m) => m.role === 'tool' && m.tool_call_id) && requests[1].messages.some((m) => m.role === 'assistant' && m.tool_calls?.length));
  await click('.chat-turn.assistant:last-child .chat-steps-toggle');
  await shot('41-chat-answer-steps');

  // 2. Something to do: take stock of a folder on this PC and set up notes.
  check('the second answer finished', await askChat(`${projects} - take stock of my projects in this folder and set them up as notes`));
  const second = await ev(`(() => { const t = [...document.querySelectorAll('.chat-turn.assistant')].at(-1); return { text: t.querySelector('.chat-answer')?.textContent || '', changes: t.querySelector('.chat-changes-head')?.textContent || '', notes: [...t.querySelectorAll('.chat-changes-notes .chat-source')].map((b) => b.textContent), error: t.querySelector('.chat-error')?.textContent || '' }; })()`);
  check('a second message works (it failed with “replayState”)', !second.error, second.error);
  check('it set up a project file per project', /Set up 2 projects/.test(second.changes) && ['Harbour Cafe bookings', 'Saltwater Bakehouse website'].every((n) => second.notes.includes(n)), JSON.stringify(second).slice(0, 260));
  const made = ['Projects/Harbour Cafe bookings/Harbour Cafe bookings.md', 'Projects/Saltwater Bakehouse website/Saltwater Bakehouse website.md'];
  const harbourFile = path.join(notes, made[0]);
  check('the project files are on disk with what it found', made.every((p) => existsSync(path.join(notes, p))) && /version 1\.4\.0/.test(readFileSync(harbourFile, 'utf8')));
  check('each carries the key the host app finds the project by', made.every((p) => /^---\ntype: project\n[\s\S]*neuralspark-project: local:/.test(readFileSync(path.join(notes, p), 'utf8'))));
  check('nothing else: no Overview, Summary, Decisions or hub', readdirSync(path.join(notes, 'Projects', 'Harbour Cafe bookings')).join() === 'Harbour Cafe bookings.md' && !existsSync(path.join(notes, 'Projects', 'All projects.md')));
  // In Sections (the file list's usual view) each project is a row of its own; in Folders, under Projects.
  check('the projects are in the file list', await waitFor(`['Harbour Cafe bookings', 'Saltwater Bakehouse website'].every((n) => [...document.querySelectorAll('.nav-project')].some((r) => r.textContent.includes(n))) || !!document.querySelector('.tree-folder[data-path="Projects"]')`, 5000));
  const pcStep = requests.some((r) => (r.messages ?? []).some((m) => m.role === 'tool' && /harbour-cafe\//.test(typeof m.content === 'string' ? m.content : JSON.stringify(m.content)) && !/node_modules\//.test(typeof m.content === 'string' ? m.content : JSON.stringify(m.content))));
  check('it read the folder it was given (package folders left out)', pcStep);
  await shot('42-chat-changes');

  // The project's page, opened from the answer.
  await ev(`[...document.querySelectorAll('.chat-turn.assistant:last-child .chat-changes-notes .chat-source')].find((b) => b.textContent.trim() === 'Harbour Cafe bookings')?.click()`);
  check('the project opens as its page', await waitFor(`document.querySelector('.pj-page h1')?.textContent === 'Harbour Cafe bookings' && /On track/.test(document.querySelector('.pj-page .pj-pill')?.textContent || '') && /Check the bookings still close at 8 pm/.test(document.querySelector('.pj-page .pj-next')?.textContent || '')`, 8000));
  check('its files come straight from its folder', await waitFor(`/README\.md/.test(document.querySelector('.pj-page')?.textContent || '')`, 8000));
  await shot('42b-project-page');

  // 4. Catch up: a change to accept, accepted, then put back.
  const before = readFileSync(harbourFile, 'utf8');
  check('the catch-up finished', await askChat('Catch up Harbour Cafe bookings'));
  check('it proposes, writing nothing yet', await waitFor(`/Health on track → at risk/.test(document.querySelector('.chat-turn.assistant:last-child .chat-proposal')?.textContent || '')`, 8000) && readFileSync(harbourFile, 'utf8') === before);
  await shot('44-chat-proposal');
  await click('.chat-turn.assistant:last-child .chat-proposal-button.primary');
  check('Accept writes the change', await waitFor(`/Accepted/.test(document.querySelector('.chat-turn.assistant:last-child .chat-proposal-state')?.textContent || '')`, 8000) && /health: at risk/.test(readFileSync(harbourFile, 'utf8')) && /Call the kitchen about winter hours — Sam/.test(readFileSync(harbourFile, 'utf8')));
  check('the page shows it at once', await waitFor(`/At risk/.test(document.querySelector('.pj-page .pj-pill')?.textContent || '')`, 8000));
  await shot('45-proposal-accepted');
  await click('.chat-turn.assistant:last-child .chat-proposal .chat-action');
  check('Undo puts the project back', await waitFor(`document.querySelector('.chat-turn.assistant:last-child .chat-proposal')?.classList.contains('is-undone')`, 8000) && readFileSync(harbourFile, 'utf8') === before);

  // 3. Undo: the notes it made go to the Recycle Bin.
  await ev(`[...document.querySelectorAll('.chat-turn.assistant')].at(-2).querySelector('.chat-changes .chat-action').click()`);
  check('Undo says what it undid', await waitFor(`/Undone: \\d+ changes/.test([...document.querySelectorAll('.chat-changes > .chat-changes-head')].find((h) => /Undone/.test(h.textContent || ''))?.textContent || '')`, 8000));
  check('the projects it set up are gone', made.every((p) => !existsSync(path.join(notes, p))));
  await shot('43-chat-undone');
  check('no exceptions in the window', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) {
  failed = true;
  console.log('FAILED', e.message);
  try { await shot('99-failure'); } catch {}
} finally {
  child.kill();
  server.close();
}
const bad = results.filter((r) => !r).length;
console.log(`\n${results.length - bad}/${results.length} checks passed`);
process.exit(failed || bad ? 1 : 0);
