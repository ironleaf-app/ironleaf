// The chat's assistant working with a project's files, end to end in the BUILT Ironleaf, driven as a person would (keys
// and clicks over the DevTools protocol), with a scripted model on this PC that asks for tools the way a real one does
// (OpenAI chat completions with tool calls, through Ironleaf's own model code). Nothing reaches a real provider.
//   npx electron-vite build && xvfb-run -a -s "-screen 0 1600x1000x24" node tools/files-e2e.mjs . /path/to/work
// The session of 18 Oct 2026, as it failed in the real app and as it goes now. The project's folder as theirs was:
// Project files/checklist/ with Cafe_Opening_Checklist_MASTER.xlsx and Cafe_Opening_Checklist_WexleySt.xlsx (many sheets), a
// README, a CHANGELOG and structure_baseline.json.
//   1., answered by a model that behaves as the real one did: it looks for "checklist" at the
//      top of the folder, reads the README and friends, then reads the two workbooks a cell range at a time by turns, the
//      same range now and then, and never writes. Now: "checklist" is found two folders down, the repeats are refused, it
//      is nudged, the work stops, and the person still gets a plain answer (one last turn with no tools); the steps are a
//      short list (the same file counted on one line) with no words meant for the model; nothing is changed.
//   2. "make the Launch template", answered by a model that follows the instructions: it searches, sees the project's own
//      copy marked, and makes the template in one make_template call: entries cleared, headings, tasks and formulas kept,
//      the originals untouched, the master mentioned. The answer links it, the card beside it opens it in the viewer, the
//      changes line says "Made 1 file" and its Undo sends the file to the Recycle Bin (here a Trash inside the work folder).
// Screenshots go to <work>/shots; exit code 1 on any failure. The work folder should be on the same drive as the home
// folder (the Trash is kept inside it).
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { freePort } from './free-port.mjs';
import { DOCX, bigPlaybook } from './office-fixtures.mjs';

const [project = '.', work = path.join(project, '.files-e2e')] = process.argv.slice(2);
const notes = path.resolve(work, 'notes');
const userData = path.resolve(work, 'userdata');
const shots = path.resolve(work, 'shots');
const pc = path.resolve(work, 'pc');
const xdg = path.resolve(work, 'xdg');
rmSync(work, { recursive: true, force: true });
for (const d of [userData, shots, xdg]) mkdirSync(d, { recursive: true });
cpSync(path.join(project, 'tools', 'review-notes'), notes, { recursive: true });

// A cafe opening's project, its folder on this PC as a real one is: the checklist two folders down (the cafe's working
// copy filled in, and the blank master), with its README, CHANGELOG and structure file.
const NAME = '07 Wexley St Ashford (Launch)';
const folder = path.join(pc, NAME);
const book = path.join(folder, 'Project files', 'checklist');
mkdirSync(book, { recursive: true });
const original = path.join(book, 'Cafe_Opening_Checklist_WexleySt.xlsx');
const master = path.join(book, 'Cafe_Opening_Checklist_MASTER.xlsx');
writeFileSync(original, bigPlaybook({ venue: 'Wexley St' }));
writeFileSync(master, bigPlaybook());
writeFileSync(path.join(book, 'README.md'), '# Cafe opening checklist\n\nThe MASTER is the blank one; each cafe keeps its own copy (Cafe_Opening_Checklist_<Store>.xlsx).\n');
writeFileSync(path.join(book, 'CHANGELOG.md'), '# Changes\n\n- v3: Opening week sheet added.\n- v2: IT & POS split from Fit-out.\n');
writeFileSync(path.join(book, 'structure_baseline.json'), JSON.stringify({ sheets: ['Overview', 'Pre-opening', 'Fit-out', 'IT & POS', 'Staffing', 'Marketing', 'Opening week', 'Contacts', 'Lists'] }));
writeFileSync(path.join(folder, 'Cafe brief.docx'), DOCX());
mkdirSync(path.join(notes, 'Projects', NAME), { recursive: true });
writeFileSync(path.join(notes, 'Projects', NAME, `${NAME}.md`), `---\ntype: project\nstatus: active\nhealth: on track\nfolder: ${folder}\n---\n# ${NAME}\n\n## Summary\n\nThe new cafe on Wexley St, Ashford.\n`);
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const originalHash = sha(original);
const masterHash = sha(master);
const template = path.join(book, 'Launch template – Cafe Opening Checklist.xlsx');
const WEXLEY = 'Project files/checklist/Cafe_Opening_Checklist_WexleySt.xlsx';
const MASTER = 'Project files/checklist/Cafe_Opening_Checklist_MASTER.xlsx';

// The scripted model: it reads where the conversation is and asks for the next tool.
const requests = [];
const turn1 = [];
const turn2 = [];
let wrapUpAsked = '';
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
const textOf = (m) => (typeof m.content === 'string' ? m.content : (m.content ?? []).map((c) => c.text ?? '').join(''));
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const json = JSON.parse(body || '{}');
    requests.push(json);
    const msgs = json.messages ?? [];
    const lastUser = [...msgs].reverse().find((m) => m.role === 'user');
    const userText = textOf(lastUser ?? {});
    const after = msgs.slice(msgs.lastIndexOf(lastUser) + 1);
    const done = after.filter((m) => m.role === 'tool').map(textOf);
    const offered = !!json.tools?.length;
    // 1. The real model's way: look, and look, and never write.
    if (/^wheres the launch checklist\?/i.test(userText)) {
      turn1.push({ tools: offered, n: done.length });
      if (!offered) {
        // The last turn, with no tools: plain words from what it was given.
        const given = textOf(lastUser);
        wrapUpAsked = given;
        return say(res, `I found the launch checklist: it's in Project files/checklist in ${NAME}, as Cafe_Opening_Checklist_WexleySt.xlsx (this store's filled-in copy) and Cafe_Opening_Checklist_MASTER.xlsx (the blank master). I looked through both but didn't make the template yet. Next: say "make the Launch template" and I'll make it from the Wexley St copy in one step.`);
      }
      const opening = [
        ['notes_overview', {}],
        ['search_notes', { query: 'launch checklist' }],
        ['search_project_files', { query: 'launch checklist' }],
        ['search_project_files', { query: 'Cafe Opening Checklist' }],
        ['list_project_folder', { project: NAME, path: 'checklist' }],
        ['read_project_file', { project: NAME, path: 'Project files/checklist/README.md' }],
        ['read_project_file', { project: NAME, path: 'Project files/checklist/CHANGELOG.md' }],
        ['read_project_file', { project: NAME, path: 'Project files/checklist/README.md', part: 2 }],
        ['read_project_file', { project: NAME, path: 'Project files/checklist/structure_baseline.json' }],
      ];
      if (done.length < opening.length) return ask(res, '', [{ name: opening[done.length][0], args: opening[done.length][1] }]);
      const i = done.length - opening.length;
      const row = i % 3 === 2 ? 4 : 4 + i * 6;
      return ask(res, '', [{ name: 'read_spreadsheet', args: { project: NAME, path: i % 2 ? WEXLEY : MASTER, range: `Fit-out!A${row}:H${row + 5}` } }]);
    }
    // 2. A model following the instructions: find it, then the template in one call.
    if (/^make the Launch template/i.test(userText)) {
      turn2.push(offered);
      if (!offered) return say(res, 'The tools were not offered.');
      if (done.length === 0) return ask(res, '', [{ name: 'search_project_files', args: { query: 'launch checklist' } }]);
      if (done.length === 1) {
        const own = /· (\S.*?\.xlsx) \([^)]*\) — this project’s own copy/.exec(done[0])?.[1];
        if (!own) return say(res, `The search didn't mark the project's own copy: ${done[0].slice(0, 300)}`);
        return ask(res, '', [{ name: 'make_template', args: { project: NAME, path: own, for: 'Launch' } }]);
      }
      const link = /link: (\[.+?\]\(nv-file:[^)]+\))/.exec(done[1])?.[1];
      const masterToo = /Beside it: Cafe_Opening_Checklist_MASTER\.xlsx \(a master copy\)/.test(done[1]);
      return say(res, link ? `Done. I made ${link} in Project files/checklist of ${NAME}: the Wexley St checklist with the owners, dates, statuses, notes and the cafe's details cleared, and the sheets, tasks, headings and formulas kept. Your Wexley St copy is untouched${masterToo ? ', and the blank master (Cafe_Opening_Checklist_MASTER.xlsx) is beside it' : ''}.` : `It didn't work: ${done[1].slice(0, 300)}`);
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

// The Recycle Bin of this run is a Trash inside the work folder (XDG_DATA_HOME), never the person's own.
const env = { ...process.env, NV_LICENSE_ORIGIN: 'http://127.0.0.1:9', NS_USER_DATA: nsUserData, XDG_DATA_HOME: xdg };
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
const lastTurn = `[...document.querySelectorAll('.chat-turn.assistant')].at(-1)`;
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
  check('the notes open', await waitFor(`!!document.querySelector('.tree-file') || !!document.querySelector('.nav-project')`, 20000));
  await ev(`document.querySelector('.side-tab[title="Chat with your notes"]')?.click()`);
  check('the chat is ready on the scripted model', await waitFor(`!!document.querySelector('.chat-input textarea:not(:disabled)') && /Scripted/.test(document.querySelector('.chat-model')?.textContent || '')`, 20000));
  // The files index reads the project's folder (the search finds the checklist by its words and name).
  await sleep(2500);

  // 1. The words, answered the way the real model went: it never writes. The person still gets an answer.
  check('the first answer finished', await askChat('wheres the launch checklist? keep it as a template.. make a copy. put it back to default then save it as a Launch template to use on a new one'));
  const first = await ev(`(() => { const t = ${lastTurn}; return { text: t.querySelector('.chat-answer')?.textContent || '', error: t.querySelector('.chat-error')?.textContent || '', toggle: t.querySelector('.chat-steps-toggle')?.textContent || '', card: t.querySelector('.cf-card.is-made') ? 'made' : '' }; })()`);
  check('the person gets a plain answer, not only steps', /I found the launch checklist/.test(first.text) && /Next: say "make the Launch template"/.test(first.text) && !first.error, JSON.stringify(first).slice(0, 300));
  check('it stopped well before the old 40 steps, with one last turn without tools', turn1.length <= 30 && turn1.at(-1)?.tools === false && turn1.slice(0, -1).every((x) => x.tools), `${turn1.length} model turns`);
  check('the last turn was given what it did and found', /<what_you_did>\nSteps:/.test(wrapUpAsked) && /Cafe_Opening_Checklist_MASTER\.xlsx/.test(wrapUpAsked), wrapUpAsked.slice(0, 200));
  const turn1Tools = requests.filter((r) => /^wheres the launch checklist/i.test(textOf([...(r.messages ?? [])].reverse().find((m) => m.role === 'user') ?? {}))).at(-2)?.messages.filter((m) => m.role === 'tool').map(textOf) ?? [];
  check('the same read again was refused', turn1Tools.some((x) => /^You already read exactly this earlier in this answer/.test(x)));
  check('it was told to act, before the end', turn1Tools.some((x) => /Ironleaf \(the app, not a file\): you have looked at/.test(x)));
  check('“checklist” was found two folders down', turn1Tools.some((x) => /the folder of that name is Project files\/checklist/.test(x)));
  check('nothing was made or changed', !first.card && !existsSync(template) && sha(original) === originalHash && sha(master) === masterHash);
  await click('.chat-turn.assistant:last-child .chat-steps-toggle');
  await sleep(300);
  const lines = await ev(`[...${lastTurn}.querySelectorAll('.chat-step:not(.kind-say) .chat-step-words')].map((s) => s.textContent)`);
  check('the steps are a short list, the same file counted on one line', lines.length <= 12 && lines.some((l) => /^Looked at the cells of Cafe_Opening_Checklist_(MASTER|WexleySt)\.xlsx in .* · \d+ times$/.test(l)), lines.join(' | '));
  check('a step shows the folder found: Project files/checklist', lines.some((l) => /^Looked in Project files\/checklist in /.test(l)));
  const MODEL = /tell (the person|them)|the person\b|don['’]t ask|act (on|now)|you (have|read|already)|steps? left|\b(list_project_folder|search_project_files|read_spreadsheet|make_template|edit_project_file|copy_project_file|read_project_file|save_as)\b|Ironleaf \(the app/i;
  check('no step carries words meant for the model', lines.every((l) => !MODEL.test(l)), lines.filter((l) => MODEL.test(l)).join(' | '));
  check('the answer has no words meant for the model either', !MODEL.test(first.text));
  await shot('60-stopped-with-an-answer');

  // 2. Asked again plainly, answered by a model following the instructions: the template in one call.
  check('the second answer finished', await askChat('make the Launch template'));
  const second = await ev(`(() => { const t = ${lastTurn}; return { text: t.querySelector('.chat-answer')?.textContent || '', links: [...t.querySelectorAll('.chat-answer a.project-file-link')].map((a) => a.textContent), changes: t.querySelector('.chat-changes-head')?.textContent || '', card: t.querySelector('.cf-card.is-made .cf-title')?.textContent || '', rows: [...t.querySelectorAll('.cf-card.is-made .cf-row .cf-name')].map((r) => r.textContent), place: t.querySelector('.cf-card.is-made .cf-place')?.textContent || '', error: t.querySelector('.chat-error')?.textContent || '', question: /which/i.test(t.querySelector('.chat-answer')?.textContent || '') }; })()`);
  check('no question back: it did the job', !second.question && !second.error, JSON.stringify(second).slice(0, 300));
  check('in a few steps (search, make the template, answer)', turn2.length <= 6 && turn2.every(Boolean), `${turn2.length} model turns`);
  check('the template is on disk beside the original', existsSync(template));
  check('the originals are exactly as they were', sha(original) === originalHash && sha(master) === masterHash);
  check('the answer mentions the master beside it', /blank master \(Cafe_Opening_Checklist_MASTER\.xlsx\) is beside it/.test(second.text));
  const tpl = readFileSync(template);
  const sheetXml = (n) => {
    // A sheet's XML, unpacked by the test's own reading of the zip (deflated parts).
    const zlib = createRequire(import.meta.url)('node:zlib');
    const min = Math.max(0, tpl.length - 65557);
    let end = -1;
    for (let i = tpl.length - 22; i >= min; i--) if (tpl.readUInt32LE(i) === 0x06054b50) { end = i; break; }
    let at = tpl.readUInt32LE(end + 16);
    for (let k = 0; k < tpl.readUInt16LE(end + 10); k++) {
      const nameLen = tpl.readUInt16LE(at + 28), extra = tpl.readUInt16LE(at + 30), comment = tpl.readUInt16LE(at + 32), offset = tpl.readUInt32LE(at + 42), size = tpl.readUInt32LE(at + 20), method = tpl.readUInt16LE(at + 10);
      const name = tpl.toString('utf8', at + 46, at + 46 + nameLen);
      if (name === `xl/worksheets/sheet${n}.xml`) {
        const start = offset + 30 + tpl.readUInt16LE(offset + 26) + tpl.readUInt16LE(offset + 28);
        const data = tpl.subarray(start, start + size);
        return (method === 8 ? zlib.inflateRawSync(data) : data).toString('utf8');
      }
      at += 46 + nameLen + extra + comment;
    }
    return '';
  };
  const overview = sheetXml(1), fitout = sheetXml(3);
  check('entries cleared, formatting kept (the cafe’s fields, owners, dates, statuses)', overview.includes('<c r="B3" s="3"/>') && overview.includes('<c r="B4" s="4"/>') && fitout.includes('<c r="C4" s="3"/>') && fitout.includes('<c r="D4" s="4"/>') && fitout.includes('<c r="E4" s="3"/>'));
  check('formulas and tasks kept', fitout.includes('<f>IF(D4="","",D4-Overview!$B$4)</f>') && fitout.includes('Strip out') && overview.includes("<f>COUNTA('Pre-opening'!B4:B60)</f>"));
  check('the answer links the new file', second.links.includes('Launch template – Cafe Opening Checklist.xlsx'), second.links.join(', '));
  check('the card beside the answer shows it', /Made for you/.test(second.card) && second.rows.some((r) => r.startsWith('Launch template – Cafe Opening Checklist.xlsx')) && second.place.includes(NAME), JSON.stringify(second).slice(0, 300));
  check('the changes line counts it as a file', /Made 1 file/.test(second.changes), second.changes);
  await shot('61-template-made');

  // The card opens it in the viewer, as a search result does.
  await click('.chat-turn.assistant:last-child .cf-card.is-made .cf-row');
  check('the viewer opens the template', await waitFor(`/Launch template – Cafe Opening Checklist\\.xlsx/.test(document.querySelector('.pf-overlay-box .pf-preview-name')?.textContent || '')`, 8000));
  check('it shows the template’s words (tasks kept, Wexley St gone)', await waitFor(`(() => { const t = document.querySelector('.pf-overlay-box')?.textContent || ''; return /Cafe Opening Checklist/.test(t) && !/Wexley St\\b(?! Ashford)/.test(t.replace(/07 Wexley St Ashford \\(Launch\\)/g, '')); })()`, 10000));
  await shot('62-template-in-viewer');
  await ev(`document.querySelector('.pf-overlay')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`);
  await sleep(300);

  // Undo: the file goes to the Recycle Bin (this run's own Trash).
  await click('.chat-turn.assistant:last-child .chat-changes .chat-action');
  check('Undo says what it undid', await waitFor(`/Undone: 1 change/.test(${lastTurn}.querySelector('.chat-changes-head')?.textContent || '')`, 8000));
  check('the template is gone, to the Trash', !existsSync(template) && existsSync(path.join(xdg, 'Trash', 'files')) && readdirSync(path.join(xdg, 'Trash', 'files')).some((n) => n.startsWith('Launch template')));
  check('the originals still untouched', sha(original) === originalHash && sha(master) === masterHash);
  await shot('63-undone');
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
