// The new pages working together, end to end, in the BUILT Ironleaf, done as a person would (real pointer and keys),
// each step proved on the files themselves:
//   xvfb-run -a -s "-screen 0 1600x1000x24" node tools/flows.mjs . /path/to/work
// A folder of made-up notes the person opened (not Ironleaf's own library) with only the two report layouts in it →
// the Templates page has every ready-made template → a project made from one → its fields changed by hand → its canvas
// → a step ticked on the canvas → the page shows it → Undo → an asset added → put into a note → where it's used → the
// graph's reasons on hover → a project dragged to another column on the portfolio board → Automations without The
// former host app. Pictures in <work>/shots; exits 1 when any check fails.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { freePort } from './free-port.mjs';

const [project = '.', work = path.join(project, '.flows')] = process.argv.slice(2);
const notes = path.resolve(work, 'notes'), userData = path.resolve(work, 'userdata'), shots = path.resolve(work, 'shots'), pc = path.resolve(work, 'pc');
rmSync(work, { recursive: true, force: true });
for (const d of [userData, shots, pc]) mkdirSync(d, { recursive: true });
cpSync(path.join(project, 'tools', 'review-notes'), notes, { recursive: true });
// Only the two report layouts in its Templates folder (as in a folder made before templates came with Ironleaf).
rmSync(path.join(notes, 'Templates'), { recursive: true, force: true });
mkdirSync(path.join(notes, 'Templates', 'Reports'), { recursive: true });
writeFileSync(path.join(notes, 'Templates', 'Reports', 'Progress report.md'), '---\ntype: report-template\nreport: progress\n---\n# Progress report\n\nOUR OWN progress report layout.\n');
writeFileSync(path.join(notes, 'Templates', 'Reports', 'Portfolio update.md'), '---\ntype: report-template\nreport: portfolio\n---\n# Portfolio update\n\nOUR OWN portfolio layout.\n');
const day = 86400000, iso = (d) => new Date(Date.now() + d * day).toISOString().slice(0, 10);
const put = (rel, text) => { mkdirSync(path.dirname(path.join(notes, rel)), { recursive: true }); writeFileSync(path.join(notes, rel), text); };
rmSync(path.join(notes, 'Projects'), { recursive: true, force: true });
put('Projects/Harbour Fit-out/Harbour Fit-out.md', `---\ntype: project\nstatus: planning\nhealth: on track\nprogress: 30\nowner: Priya Shah\ndue: "${iso(50)}"\n---\n# Harbour Fit-out\n\n## Summary\n\nThe new harbour office’s meeting rooms and network.\n\n## People\n\n- **Priya Shah** — Fit-out lead\n- **Mia Tran** — Network\n`);
put('Projects/Winter Menu Launch/Winter Menu Launch.md', `---\ntype: project\nstatus: active\nhealth: off track\nprogress: 60\nowner: Alex Lee\n---\n# Winter Menu Launch\n\n## Summary\n\nThe bakery’s winter menu. Harbour Fit-out opens the same week.\n\n## People\n\n- **Alex Lee** — Chef\n- **Mia Tran** — Website\n`);
// A logo on "this PC", to add to the assets.
writeFileSync(path.join(pc, 'Torquay sign.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="80" viewBox="0 0 200 80"><rect width="200" height="80" rx="12" fill="#1d4e89"/><text x="100" y="50" font-family="Georgia" font-size="26" fill="#f6efe2" text-anchor="middle">Torquay</text></svg>');
// Ironleaf's own library is elsewhere: this folder is one the person opened.
const library = path.resolve(work, 'own-library');
mkdirSync(library, { recursive: true });
writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ lastVault: notes, library, recentVaults: [notes, library], ...(process.env.SHOT_THEME ? { prefs: { theme: process.env.SHOT_THEME } } : {}) }));
const env = { ...process.env, NV_LICENSE_ORIGIN: 'http://127.0.0.1:9', NS_USER_DATA: path.resolve(work, 'no-host-app') };
delete env.ELECTRON_RENDERER_URL;
delete env.NV_AUTOMATIONS_STUB;
const electron = createRequire(path.resolve(project, 'package.json'))('electron');
const port = await freePort(process.env.SHOT_PORT);
const child = spawn(electron, ['.', '--no-sandbox', `--remote-debugging-port=${port}`, `--user-data-dir=${userData}`], { cwd: project, env, stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, nextId = 1;
const pending = new Map(), errors = [];
const send = (method, params = {}) => new Promise((resolve) => { const id = nextId++; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.value;
const waitFor = async (e, t = 10000) => { const end = Date.now() + t; while (Date.now() < end) { try { if (await ev(e)) return true; } catch {} await sleep(150); } return false; };
const fileSays = async (rel, test, t = 6000) => { const end = Date.now() + t; while (Date.now() < end) { try { if (test(readFileSync(path.join(notes, rel), 'utf8'))) return true; } catch {} await sleep(150); } return false; };
const results = [];
const check = (ok, words) => { results.push(!!ok); console.log(ok ? 'PASS' : 'FAIL', words); };
const shot = async (name) => { await sleep(500); const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(path.join(shots, `${name}.png`), Buffer.from(r.data, 'base64')); };
const centre = async (expr) => ev(`(() => { const el = ${expr}; if (!el) return null; el.scrollIntoView({ block: 'center', inline: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
const mouse = async (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, ...extra });
const click = async (expr) => { const c = await centre(expr); if (!c) return false; await mouse('mouseMoved', c.x, c.y, { button: 'none' }); await mouse('mousePressed', c.x, c.y); await mouse('mouseReleased', c.x, c.y); return true; };
const dblclick = async (expr) => { const c = await centre(expr); if (!c) return false; await mouse('mouseMoved', c.x, c.y, { button: 'none' }); for (const n of [1, 2]) { await mouse('mousePressed', c.x, c.y, { clickCount: n }); await mouse('mouseReleased', c.x, c.y, { clickCount: n }); } return true; }; // a value is edited by a double-click (WS1 part B: a click opens the peek)
const KEYS = { Enter: 13, Escape: 27, End: 35, z: 90 };
const key = async (k, modifiers = 0) => { const code = KEYS[k] ?? k.toUpperCase().charCodeAt(0); const base = { key: k, code: k.length === 1 ? `Key${k.toUpperCase()}` : k, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, modifiers }; await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base }); if (k === 'Enter') await send('Input.dispatchKeyEvent', { type: 'char', ...base, text: '\r' }); await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base }); };
const type = (text) => send('Input.insertText', { text });
const drag = async (from, to, steps = 14) => { await mouse('mouseMoved', from[0], from[1], { button: 'none' }); await mouse('mousePressed', from[0], from[1]); for (let i = 1; i <= steps; i++) { await mouse('mouseMoved', from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps, { buttons: 1 }); await sleep(16); } await mouse('mouseReleased', to[0], to[1]); };
const byText = (sel, text) => `[...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.textContent.includes(${JSON.stringify(text)}))`;

const NEW = 'Torquay shopfront opening';
const projectRel = `Projects/${NEW}/${NEW}.md`;
try {
  let t;
  for (let i = 0; i < 120 && !t; i++) { await sleep(250); try { t = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((x) => x.type === 'page' && x.url.startsWith('file://')); } catch {} }
  if (!t) throw new Error('no window');
  ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d.result ?? {}); pending.delete(d.id); }
    if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails?.exception?.description ?? 'exception');
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errors.push(d.params.args.map((a) => a.value ?? a.description).join(' '));
  };
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await waitFor(`!!document.querySelector('.tree-file')`, 20000);
  await ev(`document.querySelector('.side-toggle[title="Hide the right side"]')?.click()`);

  // 1. Templates: a folder that had only the two report layouts now has every ready-made template, theirs untouched.
  await click(`document.querySelector('.ribbon-button[title="Templates"]')`);
  check(await waitFor(`document.querySelectorAll('.tp-card').length >= 15`, 10000), 'Templates: every ready-made template is in a folder the person opened (it had only two report layouts)');
  check(await ev(`!document.querySelector('.tp-missing')`), '…and nothing is said to be deleted');
  check(readFileSync(path.join(notes, 'Templates', 'Reports', 'Progress report.md'), 'utf8').includes('OUR OWN'), '…their own report layout kept word for word');
  await shot('01-templates-in-another-folder');

  // 2. A project made from a template.
  await click(`document.querySelector('.ribbon-button[title="Projects"]')`);
  await waitFor(`!!document.querySelector('.pj-page.home')`);
  await click(byText('.pj-page.home .button', 'New project'));
  await waitFor(`document.querySelectorAll('.np-shape').length > 3`, 5000);
  await click(byText('.np-shape', 'Site opening'));
  await click(`document.querySelector('.np-dialog input')`);
  await type(NEW);
  await shot('02-new-project-from-template');
  await click(byText('.np-dialog .button', 'Make the project'));
  check(await waitFor(`document.querySelector('.pj-head h1')?.textContent.includes(${JSON.stringify(NEW)})`, 10000), 'a project made from the Site opening template opens on its page');
  check(await fileSays(projectRel, (s) => /## What’s next/.test(s) && /- \[ \] /.test(s) && /## Key dates/.test(s)), '…its file has the template’s next steps and key dates');

  // 3. Its fields changed by hand: the summary, in place.
  await dblclick(`document.querySelector('.pj-summary.pj-ed') ?? ${byText('.pj-ed', 'summary')}`);
  await waitFor(`!!document.querySelector('textarea.pj-summary')`, 3000);
  await key('a', 2);
  await type('A new Torquay shop on the Esplanade, open before Christmas.');
  await key('Enter', 2);
  check(await fileSays(projectRel, (s) => s.includes('A new Torquay shop on the Esplanade, open before Christmas.')), 'the summary typed on the page is written to the project file');
  await shot('03-project-edited');

  // 4. Its canvas: a step ticked there shows on the page, and Undo takes it back.
  await click(byText('.pj-actions .button', 'Canvas'));
  check(await waitFor(`document.querySelectorAll('.canvas-card.sec-next').length >= 2`, 10000), 'Canvas opens the project as a canvas, its next steps as cards');
  await sleep(600);
  const step = await ev(`document.querySelector('.canvas-card.sec-next .cv-title, .canvas-card.sec-next')?.textContent.trim().slice(0, 24)`);
  await click(`document.querySelector('.canvas-card.sec-next .cv-tick')`);
  check(await fileSays(projectRel, (s) => /- \[x\] /.test(s)), `ticking a step on the canvas writes the file (“${step}”…)`);
  await shot('04-canvas-step-ticked');
  await click(`document.querySelector('.cv-board-name')`);
  check(await waitFor(`!!document.querySelector('.pj-head h1') && /1 done/.test(document.querySelector('.pj-next-done, .pj-done-toggle, .pj-card')?.closest('.pj-page')?.textContent ?? '')`, 8000), 'the project page shows the step done');
  await click(`document.querySelector('.pj-card-head h3')`);
  await key('z', 2);
  check(await fileSays(projectRel, (s) => !/- \[x\] /.test(s)), 'Ctrl+Z on the page takes the canvas’s tick back');
  await shot('05-page-after-undo');

  // 5. An asset added from this PC, put into a note, and where it's used.
  await ev(`document.querySelector('.tree-file[data-path="Weekly menu.md"]')?.click()`);
  await waitFor(`document.querySelector('.tab-item.active')?.textContent.includes('Weekly menu')`, 5000);
  await click(`document.querySelector('.ribbon-button[title="Assets"]')`);
  await waitFor(`!!document.querySelector('.as-main')`, 8000);
  const at = await ev(`(() => { const r = document.querySelector('.as-main').getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]; })()`);
  const data = { items: [], files: [path.join(pc, 'Torquay sign.svg')], dragOperationsMask: 1 };
  for (const kind of ['dragEnter', 'dragOver', 'drop']) await send('Input.dispatchDragEvent', { type: kind, x: at[0], y: at[1], data });
  check(await waitFor(`${byText('.as-tile', 'Torquay sign')} !== undefined`, 8000), 'a logo dragged in from this PC is added to the assets');
  check(existsSync(path.join(notes, 'Assets')) && JSON.stringify(readFileSync(path.join(work, 'pc', 'Torquay sign.svg'), 'utf8')).length > 10, '…the original stays where it was');
  const tile = await centre(byText('.as-tile', 'Torquay sign'));
  await mouse('mousePressed', tile.x, tile.y);
  await mouse('mouseReleased', tile.x, tile.y);
  await waitFor(`!!document.querySelector('.as-details .as-d-cta .button.primary:not(:disabled)')`, 5000);
  await click(`document.querySelector('.as-details .as-d-cta .button.primary')`);
  check(await fileSays('Weekly menu.md', (s) => /!\[\[Torquay sign\.svg/.test(s)), 'Insert puts it into the note being worked on');
  check(await waitFor(`[...document.querySelectorAll('.as-details .as-uses li')].some((li) => li.textContent.includes('Weekly menu'))`, 8000), 'its details say where it’s used');
  await shot('06-asset-where-used');

  // 6. The graph: a relation's reasons on hover.
  await click(`document.querySelector('.ribbon-button[title^="Graph"]')`);
  await waitFor(`!!document.querySelector('.graph-canvas')?.nvGraph`, 10000);
  let g;
  for (let i = 0; i < 60; i++) { g = await ev(`document.querySelector('.graph-canvas').nvGraph()`); if (g && g.alpha < 0.02) break; await sleep(150); }
  const line = g.links.find((l) => l.kinds.includes('people')) ?? g.links.find((l) => l.kinds.includes('mentions')) ?? g.links[0];
  const A = g.nodes.find((n) => n.id === line.a), B = g.nodes.find((n) => n.id === line.b);
  await mouse('mouseMoved', (A.x + B.x) / 2, (A.y + B.y) / 2, { button: 'none' });
  check(await waitFor(`document.querySelector('.graph-tip.show')?.textContent.length > 10`, 3000), `hovering a line between ${A.title} and ${B.title} says why they’re connected`);
  console.log('   ', await ev(`document.querySelector('.graph-tip')?.textContent`));
  await shot('07-graph-reasons');
  await mouse('mouseMoved', 3, 3, { button: 'none' });

  // 7. The portfolio board: a project dragged to another column changes its status.
  await click(`document.querySelector('.ribbon-button[title="Projects"]')`);
  await waitFor(`!!document.querySelector('.pj-page.home')`);
  await sleep(400);
  await click(byText('.pj-view-link', 'Portfolio board'));
  check(await waitFor(`document.querySelectorAll('.canvas-card.part-portfolio-project').length >= 3`, 10000), 'Portfolio board opens every project in columns');
  await sleep(800);
  const harbour = await ev(`(() => { const c = [...document.querySelectorAll('.canvas-card.part-portfolio-project')].find((c) => c.textContent.includes('Harbour')); const r = (c.querySelector('.cv-project-name') ?? c).getBoundingClientRect(); return [r.x + 20, r.y + r.height / 2]; })()`);
  const active = await ev(`(() => { const c = [...document.querySelectorAll('.canvas-card.part-column')].find((c) => c.textContent.includes('Active')); const r = c.getBoundingClientRect(); return [r.x + r.width / 2, Math.min(r.y + r.height - 40, innerHeight - 140)]; })()`);
  await drag(harbour, active, 18);
  check(await fileSays('Projects/Harbour Fit-out/Harbour Fit-out.md', (s) => /^status: active$/m.test(s)), 'dragging Harbour Fit-out into Active changes its status in its file');
  await shot('08-portfolio-moved');

  // 8. Automations without the former host app: said plainly, nothing made up.
  await click(`document.querySelector('.ribbon-button[title="Automations"]')`);
  check(await waitFor(`!!document.querySelector('.au-offline') && !document.querySelector('.au-row')`, 8000), 'Automations on their own say where they live, and show none made up');
  await shot('09-automations-not-connected');

  check(errors.length === 0, `no errors in the window${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
} catch (e) {
  check(false, `the flow ran to the end (${e.message})`);
  await shot('99-failure').catch(() => {});
} finally {
  child.kill();
  const failed = results.filter((ok) => !ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exitCode = failed ? 1 : 0;
}
