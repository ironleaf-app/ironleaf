// End-to-end check of the BUILT Ironleaf: launches Electron with remote debugging, opens a throwaway copy of
// sample-vault, and drives the window through the Chrome DevTools Protocol like a person would (clicks and keys), with
// the main side's answers checked through the same bridge the window uses. Screenshots in <work>/shots.
//
//   node tools/smoke.mjs . .smoke          (Windows, or Linux under: xvfb-run -a -s "-screen 0 1600x1000x24")
// - <work> must not be under %TEMP% on Windows (policy can block electron.exe writing there).
// - No paid model calls: no former host app data and no keys, so the AI paths answer with "set up a model" words.
import { spawn } from 'node:child_process';
import { freePort } from './free-port.mjs';
import { createRequire } from 'node:module';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const [project = '.', work = path.join(project, '.smoke')] = process.argv.slice(2);
const vaultCopy = path.resolve(work, 'notes');
const userData = path.resolve(work, 'userdata');
const shots = path.resolve(work, 'shots');
rmSync(work, { recursive: true, force: true });
mkdirSync(userData, { recursive: true });
mkdirSync(shots, { recursive: true });
cpSync(path.join(project, 'sample-vault'), vaultCopy, { recursive: true });
// `other`: another folder of notes the person opened before (checked near the end).
const other = path.resolve(work, 'other-notes');
writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ lastVault: vaultCopy, library: vaultCopy, recentVaults: [vaultCopy, other] }));

const env = { ...process.env };
delete env.ANTHROPIC_API_KEY;
delete env.ANTHROPIC_AUTH_TOKEN;
delete env.ELECTRON_RENDERER_URL;
env.NV_LICENSE_ORIGIN = 'http://127.0.0.1:9';
env.NS_USER_DATA = path.resolve(work, 'no-host-app');
const exports = path.resolve(work, 'exports');
mkdirSync(exports, { recursive: true });
env.NV_TEST_EXPORT_DIR = exports;
const electron = createRequire(path.resolve(project, 'package.json'))('electron');
const port = await freePort(process.env.SMOKE_PORT);
const child = spawn(electron, ['.', '--no-sandbox', `--remote-debugging-port=${port}`, `--user-data-dir=${userData}`], { cwd: project, env, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = '';
child.stdout.on('data', (d) => (logs += d));
child.stderr.on('data', (d) => (logs += d));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

let ws;
let nextId = 1;
const pending = new Map();
const consoleErrors = [];
function send(method, params = {}) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => (pending.delete(id), reject(new Error(`CDP ${method} timed out`))), 20000);
    pending.set(id, { resolve: (v) => (clearTimeout(timer), resolve(v)), reject: (e) => (clearTimeout(timer), reject(e)) });
  });
}
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
}
async function waitFor(expression, timeout = 10000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      if (await evaluate(expression)) return true;
    } catch {}
    await sleep(120);
  }
  return false;
}
async function shot(name) {
  await sleep(250);
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path.join(shots, `${name}.png`), Buffer.from(data, 'base64'));
}
async function key(k, code, modifiers = 0, vk = 0) {
  const windowsVirtualKeyCode = vk || (k.length === 1 ? k.toUpperCase().charCodeAt(0) : 0);
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, modifiers, windowsVirtualKeyCode });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, modifiers, windowsVirtualKeyCode });
}
async function clickAt(selector) {
  // What a person clicks is on screen first (a note's lines draw a moment after its tab opens; one run in four clicked
  // before they had, 16 Oct 2026).
  await waitFor(`!!document.querySelector(${JSON.stringify(selector)})`, 5000);
  const pt = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return [r.x + Math.min(r.width / 2, 40), r.y + r.height / 2]; })()`);
  if (!pt) throw new Error(`Nothing matches ${selector}`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt[0], y: pt[1], button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt[0], y: pt[1], button: 'left', clickCount: 1 });
}
const disk = (rel) => readFileSync(path.join(vaultCopy, rel), 'utf8');

try {
  let target;
  for (let i = 0; i < 120 && !target; i++) {
    await sleep(250);
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target = list.find((t) => t.type === 'page' && t.url.startsWith('file://'));
    } catch {}
  }
  if (!target) throw new Error('The window never appeared.\n' + logs);
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => ((ws.onopen = r), (ws.onerror = j)));
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
    } else if (msg.method === 'Runtime.exceptionThrown') consoleErrors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
    else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
  };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  // Start: the library opens, the window is sandboxed and frameless.
  check('the notes open at start (the library from settings)', await waitFor(`!!document.querySelector('.tree-file')`, 20000));
  check('sandbox: no Node in the window', await evaluate(`typeof require === 'undefined' && typeof process === 'undefined'`));
  check('the bridge is there', await evaluate(`typeof window.nv?.files?.list === 'function'`));
  // The library's own notes, and Ironleaf's ready-made templates written into its Templates folder at start.
  check('every note is listed', (await evaluate(`window.nv.vault.list().then(l => l.filter(n => !n.path.startsWith('Templates/')).length)`)) === 5);
  check('the ready-made templates are in Templates/Notes, Projects and Reports', await waitFor(`window.nv.templates.list().then(r => ['Notes/Meeting notes', 'Projects/IT rollout', 'Reports/Progress report'].every(p => r.templates.some(t => t.path === 'Templates/' + p + '.md')))`, 6000));
  check('the top band drags the window (no system title bar)', await evaluate(`getComputedStyle(document.querySelector('.tab-strip')).webkitAppRegion === 'drag'`));
  // Windows draws its window buttons at the top right in the colour of what is under them (16 Oct 2026: a see-through
  // band was read as black). What is there has a solid, light colour.
  const under = await evaluate(`(() => { for (let el = document.elementFromPoint(innerWidth - 70, 12); el; el = el.parentElement) { const m = /rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?/.exec(getComputedStyle(el).backgroundColor); if (m && !(m[4] !== undefined && Number(m[4]) < 0.5)) return [+m[1], +m[2], +m[3]] } return null })()`);
  check('the window buttons sit on a solid, light colour (never black)', Array.isArray(under) && under.every((v) => v > 200), JSON.stringify(under));
  await shot('01-start');

  // A note in Live Preview.
  await clickAt('.tree-file[data-path="Welcome.md"]');
  check('clicking a note opens it in a tab', await waitFor(`document.querySelector('.tab-item.active')?.textContent.includes('Welcome')`));
  check('Live Preview draws [[links]] as links', await waitFor(`document.querySelectorAll('.cm-nv-wikilink').length >= 3`));
  check('a link to a note not written yet looks different', await evaluate(`[...document.querySelectorAll('.cm-nv-wikilink.is-unresolved')].some(e => e.textContent.includes('Ideas inbox'))`));
  check('the properties show as a panel, their YAML hidden', await waitFor(`!!document.querySelector('.properties .prop-row') && !document.querySelector('.cm-content').textContent.includes('aliases:')`));
  check('the note’s name shows as its title', await evaluate(`document.querySelector('.inline-title')?.value === 'Welcome'`));
  check('headings are drawn without their # marks (cursor elsewhere)', await evaluate(`document.activeElement?.blur(), true`) && (await waitFor(`[...document.querySelectorAll('.cm-nv-h1')].some(l => !l.textContent.includes('#'))`)));
  check('the links to this note show on the right', await waitFor(`document.querySelector('.sidebar.right')?.textContent.includes('Linking notes')`));
  await shot('02-live-preview');

  // The index, through the bridge.
  const back = await evaluate(`window.nv.index.backlinks('Linking notes.md')`);
  check('backlinks(Linking notes) includes Welcome', back.some((b) => b.source === 'Welcome.md'));
  const unl = await evaluate(`window.nv.index.unlinked('Weekly review.md')`);
  check('unlinked mentions of Weekly review are found', unl.length >= 2);
  const search = await evaluate(`window.nv.index.search('backlink')`);
  check('search finds notes with marked matches', search.length >= 2 && search[0].snippets[0]?.ranges.length > 0);
  check('search tag:routine', (await evaluate(`window.nv.index.search('tag:routine')`)).map((h) => h.title).join() === 'Weekly review');
  check('search file:daily OR file:weekly', (await evaluate(`window.nv.index.search('file:daily OR file:weekly')`)).filter((h) => !h.path.startsWith('Templates/')).length === 2);
  check('search line:(graph notes) needs both words on one line', (await evaluate(`window.nv.index.search('line:(graph notes)')`)).length >= 1 && (await evaluate(`window.nv.index.search('line:(graph backlinks)')`)).length === 0);
  check('search -excludes', !(await evaluate(`window.nv.index.search('vault -welcome')`)).some((h) => h.title === 'Welcome'));
  check('the graph has notes and links', (await evaluate(`window.nv.index.graph()`)).links.length >= 6);
  check('alias "Start here" resolves to Welcome', (await evaluate(`window.nv.notes.resolve('start here')`)) === 'Welcome.md');
  check('reading outside the notes is refused', (await evaluate(`window.nv.notes.read('../package.json').then(() => 'read!', e => e.message)`)).includes('outside'));

  // Typing, saving, and a tick-box.
  await clickAt('.cm-content .cm-line:last-child');
  await key('End', 'End', 0, 35);
  await send('Input.insertText', { text: '\n- [ ] Buy flour' });
  check('typing saves to disk', await waitFor(`window.nv.notes.read('Welcome.md').then(t => t.includes('- [ ] Buy flour'))`, 6000));
  await evaluate(`document.activeElement?.blur()`);
  await waitFor(`!!document.querySelector('.cm-nv-checkbox')`);
  await evaluate(`[...document.querySelectorAll('.cm-nv-checkbox')].at(-1).dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))`);
  check('clicking a tick-box ticks it in the file', await waitFor(`window.nv.notes.read('Welcome.md').then(t => t.includes('- [x] Buy flour'))`, 6000));

  // Properties edited in the panel.
  await evaluate(`[...document.querySelectorAll('.prop-row')].find(r => r.textContent.includes('tags'))?.querySelector('.prop-add-input')?.focus()`);
  await send('Input.insertText', { text: 'smoke' });
  await key('Enter', 'Enter', 0, 13);
  check('a tag added in the properties panel is written to the YAML', await waitFor(`window.nv.notes.read('Welcome.md').then(t => /tags:[\\s\\S]*smoke/.test(t))`, 6000));

  // Reading mode.
  await key('e', 'KeyE', 2);
  check('Ctrl+E shows Reading mode with links', await waitFor(`[...document.querySelectorAll('.reading-body a.internal-link')].some(a => a.textContent === 'Linking notes')`));
  await shot('03-reading');
  await key('e', 'KeyE', 2);
  check('Ctrl+E goes back to editing', await waitFor(`!!document.querySelector('.cm-content')`));

  // Tabs and splits.
  await evaluate(`document.querySelector('.view-header .icon-button[title="More"]').click()`);
  await evaluate(`[...document.querySelectorAll('.menu-row')].find(r => r.textContent.includes('Split right')).click()`);
  check('Split right makes a second pane', await waitFor(`document.querySelectorAll('.group').length === 2`));
  await clickAt('.tree-file[data-path="Weekly review.md"]');
  check('a note opens in the focused pane', await waitFor(`[...document.querySelectorAll('.group')].at(-1).textContent.includes('Weekly review')`));
  await key('w', 'KeyW', 2);
  await key('w', 'KeyW', 2);
  check('closing the last tab of a pane closes the pane', await waitFor(`document.querySelectorAll('.group').length === 1`));
  await shot('04-after-split');

  // A tab dragged to the right edge of its pane becomes a pane of its own there.
  await key('t', 'KeyT', 2);
  await clickAt('.tree-file[data-path="Linking notes.md"]');
  await waitFor(`document.querySelectorAll('.tab-item').length === 2`);
  await evaluate(`(() => { const tab = [...document.querySelectorAll('.tab-item')].find(t => t.textContent.includes('Linking notes')); const body = document.querySelector('.group-body'); const r = body.getBoundingClientRect(); const dt = new DataTransfer(); tab.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt })); const at = { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.right - 20, clientY: r.top + r.height / 2 }; body.dispatchEvent(new DragEvent('dragover', at)); body.dispatchEvent(new DragEvent('drop', at)); })()`);
  check('a tab dragged to a pane’s edge splits it', await waitFor(`document.querySelectorAll('.group').length === 2 && [...document.querySelectorAll('.group')].at(-1).textContent.includes('Linking notes')`));
  await key('w', 'KeyW', 2);
  await waitFor(`document.querySelectorAll('.group').length === 1`);

  // Quick switcher and commands.
  await key('o', 'KeyO', 2);
  check('Ctrl+O opens the quick switcher', await waitFor(`!!document.querySelector('.picker')`));
  await send('Input.insertText', { text: 'start here' });
  check('the switcher finds a note by another name', await waitFor(`document.querySelector('.picker-row.selected')?.textContent.includes('Start here')`));
  await key('Escape', 'Escape', 0, 27);
  await key('p', 'KeyP', 2);
  check('Ctrl+P lists the commands', await waitFor(`document.querySelectorAll('.picker-row').length > 20`));
  await key('Escape', 'Escape', 0, 27);

  // Files and folders: a folder, a move into it (links follow), a rename, the Recycle Bin.
  const folder = await evaluate(`window.nv.files.createFolder('', 'Archive')`);
  check('a new folder is made', folder === 'Archive' && existsSync(path.join(vaultCopy, 'Archive')));
  const moved = await evaluate(`window.nv.files.move('Daily notes.md', 'Archive/Daily notes.md', true)`);
  check('a note moves into a folder', moved.path === 'Archive/Daily notes.md' && existsSync(path.join(vaultCopy, 'Archive', 'Daily notes.md')));
  const renamed = await evaluate(`window.nv.files.move('Archive/Daily notes.md', 'Archive/Daily journal.md', true)`);
  check('renaming rewrites the links to it', renamed.linksUpdated >= 1 && disk('Weekly review.md').includes('[[Daily journal]]') && !disk('Weekly review.md').includes('[[Daily notes]]'), JSON.stringify(renamed));
  const folderMove = await evaluate(`window.nv.files.move('Archive', 'Old', true)`);
  check('a folder renames with what is inside', folderMove.path === 'Old' && existsSync(path.join(vaultCopy, 'Old', 'Daily journal.md')));
  check('the file list shows the folder', await waitFor(`!!document.querySelector('.tree-folder[data-path="Old"]')`, 4000));
  const canvas = await evaluate(`window.nv.files.create('', 'Plan', '.canvas', JSON.stringify({ nodes: [{ id: 'a', type: 'text', text: 'Hello', x: 0, y: 0, width: 200, height: 80 }], edges: [] }))`);
  check('a canvas is made as a JSON Canvas file', canvas === 'Plan.canvas' && JSON.parse(disk('Plan.canvas')).nodes[0].text === 'Hello');
  await waitFor(`!!document.querySelector('.tree-file[data-path="Plan.canvas"]')`, 4000);
  await clickAt('.tree-file[data-path="Plan.canvas"]');
  check('the canvas opens with its card', await waitFor(`document.querySelectorAll('.canvas-card').length === 1`));
  await shot('05-canvas');

  // Settings.
  await key(',', 'Comma', 2, 188);
  check('Ctrl+, opens Settings', await waitFor(`!!document.querySelector('.settings')`));
  check('Settings has every section', await evaluate(`['General','Look','Home cards','Packs','Quick add','Backups and sync','Keys','Models','Privacy and secrets','Agents'].every(t => document.querySelector('.settings-nav').textContent.includes(t))`));
  await evaluate(`[...document.querySelectorAll('.settings-nav button')].find(b => b.textContent.includes('Models')).click()`);
  check('Settings › Models says what to do without a model', await waitFor(`/No model is set up/.test(document.querySelector('.settings-body')?.textContent || '')`));
  await shot('06-settings');
  await key('Escape', 'Escape', 0, 27);

  // Graph.
  await key('g', 'KeyG', 2);
  check('Ctrl+G opens the graph', await waitFor(`!!document.querySelector('.graph-canvas')`));
  await sleep(1200);
  await shot('07-graph');

  // Daily note.
  await key('D', 'KeyD', 2 | 8);
  check('Ctrl+Shift+D opens today’s note', await waitFor(`/^\\d{4}-\\d{2}-\\d{2}$/.test(document.querySelector('.tab-item.active .tab-title')?.textContent || '')`));
  check('today’s note is in Daily/', existsSync(path.join(vaultCopy, 'Daily')));

  // Templates: a note in Templates/ goes in at the cursor with its {{title}} filled.
  await evaluate(`window.nv.files.create('Templates', 'Meeting', '.md', '## Notes for {{title}}\\n- ')`);
  await waitFor(`!!document.querySelector('.tree-folder[data-path="Templates"]')`, 4000);
  await clickAt('.tree-file[data-path="Welcome.md"]');
  await waitFor(`document.querySelector('.tab-item.active')?.textContent.includes('Welcome')`);
  await clickAt('.cm-content .cm-line:last-child');
  await key('End', 'End', 0, 35);
  await key('p', 'KeyP', 2);
  await waitFor(`!!document.querySelector('.picker')`);
  await send('Input.insertText', { text: 'insert a template' });
  await key('Enter', 'Enter', 0, 13);
  await waitFor(`document.querySelectorAll('.picker-row').length > 0 && document.querySelector('.picker input')?.placeholder.includes('template')`);
  await key('Enter', 'Enter', 0, 13);
  check('a template goes in at the cursor, its {{title}} filled', await waitFor(`window.nv.notes.read('Welcome.md').then(t => t.includes('## Notes for Welcome'))`, 6000));
  // A note from a template, and a project shaped by a project template (Templates page, New project).
  const fromTemplate = await evaluate(`window.nv.templates.use('Templates/Notes/Meeting notes.md', 'Supplier catch-up', '').then(p => window.nv.notes.read(p).then(t => [p, t]))`);
  check('a note from a template: named, filled, the template’s description left out', fromTemplate[0] === 'Supplier catch-up.md' && /^type: meeting$/m.test(fromTemplate[1]) && !fromTemplate[1].includes('{{') && !/description:/.test(fromTemplate[1]));
  const shaped = await evaluate(`window.nv.projects.create('Smoke laptops', '', 'Templates/Projects/IT rollout.md').then(p => window.nv.projects.view(p))`);
  check('a project from a template starts with next steps, key dates and risks', shaped.project.name === 'Smoke laptops' && shaped.project.next.length >= 5 && shaped.project.dates.length >= 3 && shaped.project.risks.length >= 3);
  const saved = await evaluate(`window.nv.templates.saveAs(${JSON.stringify(shaped.path)}, 'Smoke shape').then(() => window.nv.templates.list()).then(r => r.templates.find(t => t.name === 'Smoke shape'))`);
  check('Save as template: a project becomes a project template', saved?.kind === 'project' && saved.path === 'Templates/Projects/Smoke shape.md' && saved.counts?.next >= 5);

  // Export to PDF (the check's own folder instead of the save dialog).
  await key('p', 'KeyP', 2);
  await send('Input.insertText', { text: 'export to pdf' });
  await key('Enter', 'Enter', 0, 13);
  check('Export to PDF writes a PDF', await waitFor(`(async () => true)()`, 100) && (await (async () => { for (let i = 0; i < 40; i++) { const f = path.join(exports, 'Welcome.pdf'); if (existsSync(f) && readFileSync(f).subarray(0, 4).toString() === '%PDF') return true; await sleep(250); } return false; })()));

  // Present as slides, then back.
  await key('p', 'KeyP', 2);
  await send('Input.insertText', { text: 'present as slides' });
  await key('Enter', 'Enter', 0, 13);
  check('a note presents as slides', await waitFor(`!!document.querySelector('.slides .slide')`));
  await key('Escape', 'Escape', 0, 27);
  check('Escape ends the slides', await waitFor(`!document.querySelector('.slides')`));

  // Earlier versions.
  await key('p', 'KeyP', 2);
  await send('Input.insertText', { text: 'earlier version of a note' });
  await key('Enter', 'Enter', 0, 13);
  check('Earlier versions lists the notes with copies', await waitFor(`[...document.querySelectorAll('.versions-dialog select option')].some(r => r.textContent.includes('Welcome'))`));
  await key('Escape', 'Escape', 0, 27);

  // File recovery keeps a copy of a changed note.
  check('file recovery has copies of changed notes', await waitFor(`window.nv.recovery.list().then(l => l.some(f => f.path === 'Welcome.md'))`, 4000));

  // AI without a model: plain words, no crash.
  const chat = await evaluate(`window.nv.ai.chat('smoke-1', [{ role: 'user', content: 'How do backlinks work?' }])`);
  check('chat without a model says so, no crash', !!chat.error, chat.error);
  const links = await evaluate(`window.nv.ai.suggestLinks('Welcome.md', 'Welcome note text about Linking notes')`);
  check('suggested links without a model say so', !!links.error, links.error);

  // Private notes (src/main/private-notes.ts): set up with a recovery password (no Windows Hello here), a note written in a
  // tab like any note, nothing readable on disk or reachable by the vault, locked (its tab closes and the saved layout
  // never names it), a wrong password refused, opened again with the right one.
  await clickAt('.ribbon-button[title="Private notes"]');
  check('Locked offers to set it up', await waitFor(`/Set up Locked/.test(document.querySelector('.pv-card')?.textContent || '')`));
  await shot('30-private-setup');
  await clickAt('.pv-card label.pv-field:nth-of-type(1) input');
  await send('Input.insertText', { text: 'smoke recovery phrase' });
  await clickAt('.pv-card label.pv-field:nth-of-type(2) input');
  await send('Input.insertText', { text: 'smoke recovery phrase' });
  await clickAt('.pv-go');
  check('set up and open at once', await waitFor(`/No private notes yet/.test(document.querySelector('.pv-empty')?.textContent || '')`, 20000));
  await clickAt('.pv-empty .button');
  await waitFor(`!!document.querySelector('.dialog input')`);
  await send('Input.insertText', { text: 'Smoke diary' });
  await key('Enter', 'Enter', 0, 13);
  check('a private note opens in a tab, marked Private', await waitFor(`document.querySelector('.tab-item.active')?.textContent.includes('Smoke diary') && !!document.querySelector('.view-private') && !document.querySelector('.view-action-send')`, 8000));
  await clickAt('.cm-content .cm-line:last-child');
  await send('Input.insertText', { text: 'The secret ingredient is cardamom.' });
  check('it saves into the encrypted store', await waitFor(`window.nv.private.read('Private notes/Smoke diary.md').then(t => t.includes('cardamom'))`, 8000));
  const privateDir = path.join(vaultCopy, 'Private notes');
  const sealed = readdirSync(privateDir).map((n) => readFileSync(path.join(privateDir, n), 'utf8')).join('\n');
  check('nothing readable on disk, not even its name', readdirSync(privateDir).some((n) => n.endsWith('.nvlock')) && !/cardamom|Smoke diary/.test(sealed));
  check('not in the index or the file list', await evaluate(`(async () => { const all = await window.nv.vault.list(); const files = await window.nv.files.list(); return !all.some((m) => /^private notes/i.test(m.path)) && !files.folders.some((f) => /^private notes/i.test(f)) && !files.files.some((f) => /^private notes/i.test(f.rel)); })()`));
  check('the vault refuses its folder', await evaluate(`window.nv.notes.read('Private notes/Smoke diary.md').then(() => false, () => true)`));
  await shot('31-private-note');
  // Nothing that copies or sends it out: not offered for a private note, and the AI side refuses it whatever asks.
  await key('p', 'KeyP', 2);
  await waitFor(`!!document.querySelector('.picker')`);
  await send('Input.insertText', { text: 'export' });
  check('no Export or copy for a private note', await waitFor(`(() => { const rows = [...document.querySelectorAll('.picker-row')].map((r) => r.textContent); return !rows.some((t) => /Export to PDF|Make a copy/.test(t)); })()`, 3000));
  await key('Escape', 'Escape', 0, 27);
  const refused = await evaluate(`window.nv.ai.suggestLinks('Private notes/Smoke diary.md', 'The secret ingredient is cardamom.')`);
  check('suggested links never send a private note to the AI', /Private notes aren’t sent to the AI/.test(refused.error || ''), refused.error);
  await key('p', 'KeyP', 2);
  await send('Input.insertText', { text: 'lock private notes' });
  await key('Enter', 'Enter', 0, 13);
  check('locking closes its tab', await waitFor(`!document.querySelector('.view-private') && ![...document.querySelectorAll('.tab-item')].some((t) => t.textContent.includes('Smoke diary'))`, 8000));
  check('the saved layout never names a private note', await waitFor(`window.nv.state.load('workspace').then((w) => !!w && !JSON.stringify(w).includes('Smoke diary'))`, 4000));
  await clickAt('.ribbon-button[title="Private notes"]');
  check('locked: it asks for the recovery password', await waitFor(`/Locked/.test(document.querySelector('.pv-card h1')?.textContent || '')`));
  await clickAt('.pv-password input');
  await send('Input.insertText', { text: 'not the password' });
  await clickAt('.pv-password button');
  check('a wrong password is refused', await waitFor(`/isn’t the recovery password/.test(document.querySelector('.pv-said')?.textContent || '')`, 15000));
  await clickAt('.pv-password input');
  await key('a', 'KeyA', 2);
  await send('Input.insertText', { text: 'smoke recovery phrase' });
  await clickAt('.pv-password button');
  check('the right one opens them, the note listed', await waitFor(`[...document.querySelectorAll('.pv-row-87 .t')].some((r) => r.textContent === 'Smoke diary')`, 15000));
  await shot('32-private-list');

  // Another folder of notes (not Ironleaf's own library) with only the two report layouts: the ready-made templates
  // are added the first time it opens; nothing is called deleted; its own two are kept as they were.
  mkdirSync(path.join(other, 'Templates', 'Reports'), { recursive: true });
  writeFileSync(path.join(other, 'Templates', 'Reports', 'Progress report.md'), '# Progress report\n\nOURS\n');
  writeFileSync(path.join(other, 'Templates', 'Reports', 'Portfolio update.md'), '# Portfolio update\n\nOURS\n');
  writeFileSync(path.join(other, 'Plans.md'), '# Plans\n');
  await evaluate(`window.nv.vault.open(${JSON.stringify(other)})`);
  check('another folder: the ready-made templates are added when it first opens', await waitFor(`window.nv.templates.list().then((r) => ['Notes/Meeting notes', 'Projects/IT rollout', 'Notes/Risk log'].every((p) => r.templates.some((t) => t.path === 'Templates/' + p + '.md')))`, 8000));
  check('…its own report layouts kept word for word', readFileSync(path.join(other, 'Templates', 'Reports', 'Progress report.md'), 'utf8').includes('OURS'));
  check('…and nothing is called deleted', (await evaluate(`window.nv.templates.missing()`)).length === 0);
  rmSync(path.join(other, 'Templates', 'Notes', 'Risk log.md'));
  await evaluate(`window.nv.vault.open(${JSON.stringify(other)})`);
  await sleep(600);
  check('a template deleted there stays deleted, and is the one offered back', !existsSync(path.join(other, 'Templates', 'Notes', 'Risk log.md')) && JSON.stringify(await evaluate(`window.nv.templates.missing()`)) === '["Risk log"]');
  await evaluate(`window.nv.vault.library()`);

  check('no exceptions or console errors in the window', consoleErrors.length === 0, consoleErrors.slice(0, 5).join(' | '));
} catch (err) {
  check('the check ran to the end', false, err.stack ?? String(err));
  try {
    await shot('99-failure');
  } catch {}
} finally {
  try {
    await Promise.race([send('Browser.close'), sleep(2000)]);
  } catch {}
  await sleep(500);
  child.kill();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  if (failed && logs.trim()) console.log('--- electron output ---\n' + logs.trim().slice(-3000));
  process.exit(failed ? 1 : 0);
}
