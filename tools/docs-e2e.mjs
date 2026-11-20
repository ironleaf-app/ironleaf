// Docs in the BUILT Ironleaf, driven as a person would (real clicks and keys through the screens), with screens for
// design review (18 Oct 2026):
//   a family Minecraft server set up as a project (summary; Server, Access, Operations, Add-ons; Updates; a Backups page,
//   an Activity note, a canvas) → Turn into a doc (its page's ⋯ menu) → the doc page → Show as canvas → a section heading
//   changed in the doc → Update canvas from doc (in place). Then New doc from a doc template, Turn into a doc's Undo, the
//   Docs side bar, the Templates page's Docs, and the doc page at 900, 1440 and 2560 px.
//   xvfb-run -a -s "-screen 0 2600x1500x24" node tools/docs-e2e.mjs . /path/to/work
//   SHOT_THEME=dark … for the dark screens (the checks run in either).
import { spawn } from 'node:child_process';
import { freePort } from './free-port.mjs';
import { createRequire } from 'node:module';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const [project = '.', work = path.join(project, '.docs-e2e')] = process.argv.slice(2);
const theme = process.env.SHOT_THEME === 'dark' ? 'dark' : 'light';
const notes = path.resolve(work, 'notes'), userData = path.resolve(work, 'userdata'), shots = path.resolve(work, 'shots');
rmSync(work, { recursive: true, force: true });
for (const d of [userData, shots]) mkdirSync(d, { recursive: true });
cpSync(path.join(project, 'tools', 'review-notes'), notes, { recursive: true });
const day = 86400000, now = Date.now();
const write = (rel, content, ageDays = 1) => {
  const abs = path.join(notes, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, content);
  const t = new Date(now - ageDays * day);
  utimesSync(abs, t, t);
};
const disk = (rel) => { try { return readFileSync(path.join(notes, rel), 'utf8'); } catch { return null; } };

// The case, made up: documentation forced into a project.
const MC = 'Projects/Minecraft server';
write(`${MC}/Minecraft server.md`, `---
type: project
status: active
health: on track
tags: [minecraft, family]
updated: 2026-10-17
---
# Minecraft server

## Summary

The family's Minecraft server: a Paper server on the old desktop in the study, for the kids, their cousins and a few school friends. It runs most evenings and all weekend.

## Server

- Paper 1.21.1 on Ubuntu 24.04, on the study desktop (hostname **juniper**)
- 6 GB of memory for the server, the world on the second drive
- Starts with the machine (a systemd service called \`minecraft\`)

## Access

- Whitelist only: a parent adds a name with \`/whitelist add <name>\`
- From outside the house through the router's port 25565
- Operators: Dad and Mia

## Operations

- Restart every Sunday night after the backup
- Update Paper on the first weekend of the month; check the add-ons still load
- Watch the log for "Can't keep up!" (the server is overloaded)

## Add-ons

- EssentialsX (homes, warps)
- Dynmap, so the cousins can see the world in a browser
- CoreProtect, to roll back griefing

## Updates

- **17 Oct 2026** — Dynmap moved to its own port so the router rule is simpler.
- **12 Oct 2026** — Whitelist turned on after strangers joined.

## Documentation

- [[Backups]]
`, 2);
write(`${MC}/Backups.md`, `# Backups

The world folder is copied to the NAS every night at 2 am by a cron job.

## Restoring

Stop the server, copy the night's folder back over \`world/\`, start it again. See [[Minecraft server]] for the service.
`, 3);
write(`${MC}/Activity/Turn on the whitelist.md`, '---\nstatus: done\n---\nWhitelist on; Dad and Mia are operators.\n', 6);
write(`${MC}/Minecraft server.canvas`, JSON.stringify({ nodes: [
  { id: 'p', type: 'file', file: `${MC}/Minecraft server.md`, x: -220, y: -136, width: 440, height: 272, neuralvault: { part: 'project', project: `${MC}/Minecraft server.md` } },
  { id: 'idea', type: 'text', text: 'Idea: a creative world for the little ones', x: 1100, y: -60, width: 280, height: 110, color: '4' },
], edges: [], neuralvault: { kind: 'project', project: `${MC}/Minecraft server.md` } }, null, '\t'), 2);
write('Daily/2026-10-17.md', 'Fixed the [[Backups]] cron again. Check [[Minecraft server]] tonight.\n', 1);
// A doc already there, and a small project to try Undo on.
write('Docs/Home network.md', `---
type: doc
about: How the house network is set up, and what to try when it drops out.
tags: [network]
hostname: gateway
updated: 2026-10-16
---
# Home network

The NBN comes in to the hallway cupboard; the router and the NAS live there, with a mesh point upstairs.

## Setup

- Router: the ISP's modem in bridge mode, then our own router
- Mesh point in the upstairs hall, wired back

## Access

- The router's page is at 192.168.1.1; its password is in the family password manager
- Guest Wi-Fi for visitors, off the main network

## Troubleshooting

- **Wi-Fi drops upstairs** — restart the mesh point first, then the router
- **No internet at all** — check the modem's lights; call the ISP if "DSL" is off

## Changes

- **16 Oct 2026** — Guest Wi-Fi added.
- **2 Oct 2026** — Mesh point moved to the upstairs hall.
`, 2);
write('Projects/Pool pump/Pool pump.md', '---\ntype: project\nstatus: active\n---\n# Pool pump\n\n## Summary\n\nHow the pool pump timer is set.\n\n## Timer\n\nRuns 10 am to 4 pm in summer.\n', 4);

writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ lastVault: notes, library: notes, recentVaults: [notes], prefs: { theme } }));
// A made-up Recycle Bin (a development build's checks put what goes to the bin here, to look at).
const bin = path.resolve(work, 'Recycle Bin');
const env = { ...process.env, NV_LICENSE_ORIGIN: 'http://127.0.0.1:9', NS_USER_DATA: path.resolve(work, 'none'), NV_TRASH_DIR: bin };
delete env.ELECTRON_RENDERER_URL;
const electron = createRequire(path.resolve(project, 'package.json'))('electron');
const port = await freePort(process.env.SHOTS_PORT || process.env.SHOT_PORT);
const child = spawn(electron, ['.', '--no-sandbox', `--remote-debugging-port=${port}`, `--user-data-dir=${userData}`], { cwd: project, env, stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, nextId = 1; const pending = new Map(); const errors = [];
const send = (method, params = {}) => new Promise((resolve) => { const id = nextId++; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.value;
const waitFor = async (e, t = 10000) => { const end = Date.now() + t; while (Date.now() < end) { try { if (await ev(e)) return true; } catch {} await sleep(150); } return false; };
const checks = [];
const check = (ok, words) => { checks.push(`${ok ? 'PASS' : 'FAIL'} ${words}`); console.log(ok ? 'PASS' : 'FAIL', words); };
const centre = async (expr) => ev(`(() => { const el = ${expr}; if (!el) return null; el.scrollIntoView({ block: 'nearest' }); const r = el.getBoundingClientRect(); return { x: r.left + Math.min(r.width / 2, 90), y: r.top + r.height / 2 }; })()`);
const mouse = async (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, ...extra });
const click = async (expr, extra = {}) => { const c = await centre(expr); if (!c) return false; await mouse('mouseMoved', c.x, c.y, { button: 'none' }); await mouse('mousePressed', c.x, c.y, extra); await mouse('mouseReleased', c.x, c.y, extra); return true; };
const dblclick = async (expr) => { const c = await centre(expr); if (!c) return false; await mouse('mouseMoved', c.x, c.y, { button: 'none' }); await mouse('mousePressed', c.x, c.y, { clickCount: 1 }); await mouse('mouseReleased', c.x, c.y, { clickCount: 1 }); await mouse('mousePressed', c.x, c.y, { clickCount: 2 }); await mouse('mouseReleased', c.x, c.y, { clickCount: 2 }); return true; };
const KEYS = { Enter: 13, Escape: 27, End: 35, Home: 36, ArrowDown: 40, ArrowUp: 38, ArrowRight: 39, ArrowLeft: 37 };
const key = async (k, modifiers = 0) => { const code = KEYS[k] ?? k.toUpperCase().charCodeAt(0); const base = { key: k, code: k.length === 1 ? `Key${k.toUpperCase()}` : k, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, modifiers }; await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base }); if (k === 'Enter') await send('Input.dispatchKeyEvent', { type: 'char', ...base, text: '\r' }); await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base }); };
const type = async (text) => send('Input.insertText', { text });
const shot = async (name) => { await sleep(500); const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(path.join(shots, `${theme === 'dark' ? 'dark-' : ''}${name}.png`), Buffer.from(r.data, 'base64')); console.log('shot', name); };
const size = (width, height) => send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
const row = (id) => `document.querySelector('.nav-body [data-id=${JSON.stringify(id).replace(/'/g, "\\'")}]')`;
const sectionHead = (label) => `[...document.querySelectorAll('.nav-section')].find((s) => s.querySelector('.nav-section-label')?.textContent === ${JSON.stringify(label)})`;
const menuItem = (label) => `[...document.querySelectorAll('.menu .menu-item, .menu button')].find((b) => b.textContent.trim().startsWith(${JSON.stringify(label)}))`;
const button = (scope, words) => `[...document.querySelectorAll('${scope} button')].find((b) => b.textContent.trim() === ${JSON.stringify(words)})`;
const toastText = () => ev(`document.querySelector('.toast')?.textContent ?? ''`);

try {
  let t; for (let i = 0; i < 120 && !t; i++) { await sleep(250); try { t = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((x) => x.type === 'page'); } catch {} }
  ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d.result); pending.delete(d.id); } if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails?.exception?.description ?? 'exception'); };
  await send('Runtime.enable'); await send('Page.enable');
  await size(1440, 900);
  check(await waitFor(`!!document.querySelector('.nav-section')`, 20000), 'the side bar opens in sections');
  await waitFor(`!!document.querySelector('.nav-doc')`, 8000);
  await sleep(500);

  // 1. The side bar: Docs between Projects and Notes, counted; a doc is not a note in Notes.
  const heads = await ev(`[...document.querySelectorAll('.nav-section')].map((s) => s.querySelector('.nav-section-label').textContent + ' ' + s.querySelector('.nav-section-count').textContent)`);
  check(heads[0].startsWith('Projects') && heads[1] === 'Docs 1' && heads[2].startsWith('Notes'), `Docs sits between Projects and Notes, counted (${heads.slice(0, 3).join(' · ')})`);
  check(await ev(`!!${row('doc:Docs/Home network.md')} && ![...document.querySelectorAll('.nav-folder')].some((f) => f.dataset.path === 'Docs')`), 'a doc is listed under Docs, not as a note in a Docs folder');
  await shot('01-sidebar-docs');

  // 2. The project's page: ⋯ › Turn into a doc… (one plain question), then it is a doc.
  await click(row(`p:${MC}/Minecraft server.md`));
  check(await waitFor(`!!document.querySelector('.pj-page')`, 6000), 'the Minecraft server project opens as its page (as it was forced into)');
  await click(`[...document.querySelectorAll('.view-header .icon-button')].find((b) => b.title === 'More')`);
  await sleep(250);
  check(await ev(`!!${menuItem('Turn into a doc…')}`), 'its page’s ⋯ menu has Turn into a doc…');
  await click(menuItem('Turn into a doc…'));
  check(await waitFor(`!!document.querySelector('.dialog')?.textContent.includes('Every word is kept')`, 4000), 'it asks once, saying every word is kept and Undo puts it back');
  await shot('02-turn-into-doc-question');
  await click(button('.dialog', 'Turn into a doc'));
  check(await waitFor(`!!document.querySelector('.note-view.is-doc .doc-head')`, 8000), 'the doc opens as a doc page');
  const toast1 = await toastText();
  check(/Turned “Minecraft server” into a doc: 1 page became sections, \d+ links? now reach(?:es)? it\. The project and its pages are in the Recycle Bin\./.test(toast1), `it says what it did, with Undo (${toast1})`);
  const doc = disk('Docs/Minecraft server.md') ?? '';
  check(/^---\ntype: doc\ntags: \[minecraft, family\]\ncanvas: Docs\/Minecraft server\.canvas\nupdated: \d{4}-\d{2}-\d{2}\n---\n# Minecraft server\n\nThe family's Minecraft server/.test(doc), 'the doc: type doc, tags, canvas, updated; its name and summary');
  check(['## Server', '## Access', '## Operations', '## Add-ons', '## Backups', '## Changes'].every((h) => doc.includes(`\n${h}\n`)) && doc.indexOf('## Backups') < doc.indexOf('## Changes'), 'its sections, its page as a section, then Changes');
  check(doc.includes('### Restoring') && doc.includes('- **17 Oct 2026** — Dynmap moved to its own port') && doc.includes('See [[Minecraft server]] for the service.'), 'the page’s part nested, Updates as Changes, links kept');
  for (const w of ['juniper', 'CoreProtect', "Can't keep up!", 'every night at 2 am', 'Whitelist turned on after strangers joined']) check(doc.includes(w), `every word kept: “${w}”`);
  check(!existsSync(path.join(notes, `${MC}/Minecraft server.md`)) && !existsSync(path.join(notes, `${MC}/Backups.md`)) && !existsSync(path.join(notes, `${MC}/Minecraft server.canvas`)), 'the project file, its page and its old canvas went (to the Recycle Bin)');
  const binned = existsSync(bin) ? readdirSync(bin) : [];
  check(['Minecraft server.md-', 'Backups.md-', 'Minecraft server.canvas-'].every((n) => binned.some((f) => f.startsWith(n))), `…and they are in the Recycle Bin (${binned.join(', ')})`);
  check(existsSync(path.join(notes, `${MC}/Activity/Turn on the whitelist.md`)), 'the host app’s task note stays where it was');
  check((disk('Daily/2026-10-17.md') ?? '').includes('[[Minecraft server#Backups|Backups]]'), 'a link to its page now reaches the doc at that section');
  check(await ev(`!!${row('doc:Docs/Minecraft server.md')} && !${row(`p:${MC}/Minecraft server.md`)}`), 'the side bar lists it under Docs, no longer under Projects');
  check(await ev(`[...document.querySelectorAll('.doc-toc-link')].map((b) => b.textContent).join('|') === 'Server|Access|Operations|Add-ons|Backups|Changes'`), 'its contents list every section, Changes last');
  check(await ev(`!!document.querySelector('.cm-nv-doc-summary')`), 'the summary is marked');
  await shot('03-doc-page');
  await ev(`(() => { const s = document.querySelector('.note-view.is-doc .cm-scroller'); s.scrollTo({ top: s.scrollHeight }); })()`);
  check(await waitFor(`document.querySelectorAll('.cm-nv-doc-change').length >= 2 && !!document.querySelector('.cm-nv-doc-changes-head')`, 3000), 'Changes drawn as a quiet dated list');
  await shot('03b-doc-changes');
  await ev(`document.querySelector('.note-view.is-doc .cm-scroller').scrollTo({ top: 0 })`);
  await sleep(600);

  // A contents link goes to its section.
  await click(button('.doc-toc', 'Add-ons'));
  await sleep(400);
  await sleep(300);
  const gap = await ev(`(() => { const h = [...document.querySelectorAll('.cm-line.cm-nv-h2')].find((l) => l.textContent.includes('Add-ons')); const s = h?.closest('.cm-scroller'); return h && s ? Math.round(h.getBoundingClientRect().top - s.getBoundingClientRect().top) : null; })()`);
  check(gap !== null && Math.abs(gap) < 120, `a contents link scrolls its section to the top (${gap} px from it)`);
  await ev(`document.querySelector('.note-view.is-doc .cm-scroller')?.scrollTo({ top: 0 })`);
  await sleep(500);

  // The about line, added from the head.
  await click(`document.querySelector('.doc-about.is-empty')`);
  if (await waitFor(`!!document.querySelector('.dialog input, .dialog textarea')`, 3000)) {
    await type('How the family Minecraft server is set up and run.');
    await click(button('.dialog', 'Save'));
    check(await waitFor(`document.querySelector('.doc-about')?.textContent === 'How the family Minecraft server is set up and run.'`, 4000), 'the about line is added from the head and shows under the title');
    await sleep(900);
    check(/^about: How the family Minecraft server is set up and run\.$/m.test(disk('Docs/Minecraft server.md') ?? ''), 'and is written into the doc’s properties');
  } else check(false, 'the about line asks for its words');

  // 3. Show as canvas: the re-pointed canvas, the doc's card and a card per section; double-click opens the doc there.
  await click(`[...document.querySelectorAll('.view-header .view-header-action')].find((b) => /Canvas/.test(b.textContent))`);
  check(await waitFor(`document.querySelectorAll('.canvas-card.is-doc-card').length >= 6`, 8000), 'Show as canvas opens its canvas: the doc’s card and a card per section');
  const board1 = JSON.parse(disk('Docs/Minecraft server.canvas') ?? '{}');
  check(board1.neuralvault?.kind === 'doc' && board1.nodes?.some((n) => n.id === 'idea') && !board1.nodes?.some((n) => n.id === 'p'), 'the project’s canvas was re-pointed: the person’s own card kept, the project’s card gone');
  const access1 = board1.nodes?.find((n) => n.neuralvault?.part === 'section' && n.neuralvault.heading === 'Access');
  check(!!access1 && access1.subpath === '#Access' && access1.file === 'Docs/Minecraft server.md', 'each section card opens the doc at its heading');
  check(await waitFor(`!!document.querySelector('.cv-board-bar .cv-board-action')`, 3000), 'the canvas says it is the doc’s, with Update from doc');
  await shot('04-doc-canvas');
  await dblclick(`[...document.querySelectorAll('.canvas-card.is-doc-card')].find((c) => c.querySelector('.canvas-card-title')?.textContent.includes('Operations'))`);
  check(await waitFor(`(() => { const h = [...document.querySelectorAll('.cm-line.cm-nv-h2')].find((l) => l.textContent.includes('Operations')); const s = h?.closest('.cm-scroller'); return !!h && !!s && h.getBoundingClientRect().top - s.getBoundingClientRect().top < s.clientHeight * 0.7; })()`, 5000), 'double-clicking a section card opens the doc at that heading');

  // 4. A section heading changed in the doc (typed, as a person would): Access → Who can play.
  await click(`[...document.querySelectorAll('.tab-item')].find((t) => t.textContent.includes('Minecraft server') && !t.textContent.includes('.canvas'))`);
  await sleep(300);
  const line = `[...document.querySelectorAll('.note-view.is-doc .cm-line.cm-nv-h2')].find((l) => l.textContent.trim().replace(/^#+\\s*/, '') === 'Access')`;
  await click(line);
  await key('End');
  await key('Home', 8);
  await type('## Who can play');
  await sleep(1300);
  check(/\n## Who can play\n/.test(disk('Docs/Minecraft server.md') ?? '') && !/\n## Access\n/.test(disk('Docs/Minecraft server.md') ?? ''), 'the heading is changed in the doc');

  // 5. Update canvas from doc: in place — the card renamed where it was; nothing new, nothing lost.
  await click(`document.querySelector('.view-header [aria-label="Update canvas from doc"]')`);
  check(await waitFor(`(document.querySelector('.toast')?.textContent ?? '').includes('Canvas updated: 1 renamed')`, 5000), `it says what it did (${await toastText()})`);
  const board2 = JSON.parse(disk('Docs/Minecraft server.canvas') ?? '{}');
  const renamed = board2.nodes?.find((n) => n.id === access1?.id);
  check(!!renamed && renamed.subpath === '#Who can play' && renamed.neuralvault?.heading === 'Who can play' && renamed.x === access1.x && renamed.y === access1.y, 'the Access card is now Who can play, where it was');
  check(board2.nodes?.length === board1.nodes?.length && board2.nodes?.some((n) => n.id === 'idea'), 'no second card, the person’s own card kept');
  check(!existsSync(path.join(notes, 'Docs/Minecraft server 2.canvas')), 'never a second canvas');
  await click(`[...document.querySelectorAll('.tab-item')].find((t) => t.textContent.includes('Minecraft server') && t.querySelector('.tab-icon') && t !== document.querySelector('.tab-item.active'))`);
  await waitFor(`!!document.querySelector('.canvas-card.is-doc-card')`, 4000);
  await shot('05-canvas-updated');

  // 6. Turn into a doc, then Undo: every file back.
  const poolBefore = disk('Projects/Pool pump/Pool pump.md');
  await click(`${row('p:Projects/Pool pump/Pool pump.md')}`);
  await waitFor(`!!document.querySelector('.pj-page')`, 5000);
  await click(`[...document.querySelectorAll('.view-header .icon-button')].find((b) => b.title === 'More')`);
  await click(menuItem('Turn into a doc…'));
  await waitFor(`!!document.querySelector('.dialog')`, 3000);
  await click(button('.dialog', 'Turn into a doc'));
  check(await waitFor(`(document.querySelector('.toast')?.textContent ?? '').includes('Turned “Pool pump” into a doc')`, 6000), 'a second project turned into a doc');
  await click(`document.querySelector('.toast button')`);
  check(await waitFor(`(document.querySelector('.toast')?.textContent ?? '').startsWith('Undone')`, 6000), `Undo says it is undone (${await toastText()})`);
  await sleep(600);
  check(disk('Projects/Pool pump/Pool pump.md') === poolBefore && !existsSync(path.join(notes, 'Docs/Pool pump.md')), 'Undo put the project back word for word, and the doc went');

  // 7. New doc from a doc template (the Docs section's +).
  await ev(`document.querySelector('.nav-body').scrollTo({ top: 0 })`);
  await click(`${sectionHead('Docs')}.querySelector('.nav-section-add')`);
  check(await waitFor(`[...document.querySelectorAll('.picker-label')].map((l) => l.textContent).join('|').includes('System or server')`, 4000), 'New doc offers the doc templates (and a blank doc)');
  await shot('06-new-doc-kinds');
  await click(`[...document.querySelectorAll('.picker-row')].find((r) => r.textContent.includes('Runbook'))`);
  await waitFor(`!!document.querySelector('.dialog input')`, 3000);
  await type('Garage NAS');
  await click(button('.dialog', 'Make the doc'));
  check(await waitFor(`!!document.querySelector('.note-view.is-doc .doc-head')`, 6000) && /^---\ntype: doc\n/.test(disk('Docs/Garage NAS.md') ?? ''), 'a new doc from the Runbook template, in Docs, opened as a doc');
  check((disk('Docs/Garage NAS.md') ?? '').includes('## Quick checks') && !(disk('Docs/Garage NAS.md') ?? '').includes('doc-template') && !(disk('Docs/Garage NAS.md') ?? '').includes('description:'), 'with the template’s sections, none of the template’s own properties');

  // 8. The side bar with three docs, a doc opened (its canvas under it).
  await ev(`document.querySelector('.nav-body').scrollTo({ top: 0 })`);
  await click(row('doc:Docs/Minecraft server.md'));
  await sleep(300);
  const opened = await waitFor(`!!${row('Docs/Minecraft server.canvas')}`, 2000);
  check(opened, 'a doc opened from the side bar shows its canvas under it');
  await click(row('doc:Docs/Home network.md'));
  await waitFor(`document.querySelector('.doc-about')?.textContent.includes('house network')`, 5000);
  check(await ev(`document.querySelector('.doc-computer')?.textContent === 'On gateway'`), 'a doc about a computer says which one');
  await shot('07-sidebar-and-home-network');

  // 9. Search and quick open treat docs as docs.
  await key('o', 2);
  await type('network');
  check(await waitFor(`[...document.querySelectorAll('.picker-row')].some((r) => r.textContent.includes('Home network') && r.textContent.includes('Doc ·'))`, 3000), 'quick open says a doc is a doc, with its line on what it is');
  await key('Escape');

  // 10. The Templates page: its Docs group.
  await key('p', 2);
  await type('Open the Templates page');
  await key('Enter');
  check(await waitFor(`[...document.querySelectorAll('.tp-group-head')].some((h) => h.textContent.includes('Docs'))`, 5000), 'the Templates page has its Docs group');
  await ev(`[...document.querySelectorAll('.tp-group-head')].find((h) => h.textContent.includes('Docs'))?.scrollIntoView({ block: 'start' })`);
  await shot('08-templates-docs');

  // 11. The doc page at three widths.
  await click(row('doc:Docs/Minecraft server.md'));
  await waitFor(`!!document.querySelector('.note-view.is-doc .doc-head')`, 5000);
  for (const [w, h] of [[900, 760], [1440, 900], [2560, 1440]]) {
    await size(w, h);
    await sleep(500);
    const over = await ev(`document.documentElement.scrollWidth > window.innerWidth + 1`);
    check(!over, `the doc page fits ${w} px wide`);
    await shot(`09-doc-page-${w}`);
  }
  await size(1440, 900);
  // Reading mode: the same head, Changes quiet.
  await click(`[...document.querySelectorAll('.view-header .icon-button')].find((b) => /^Read/.test(b.title))`);
  check(await waitFor(`!!document.querySelector('.reading .doc-head.with-title') && !!document.querySelector('.reading-body .doc-changes')`, 4000), 'Reading mode: the title, about line and contents above; Changes quiet');
  await shot('10-doc-reading');

  check(!errors.length, `no errors in the window${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
} catch (err) {
  check(false, `the run finished (${err?.stack ?? err})`);
} finally {
  writeFileSync(path.join(shots, `${theme === 'dark' ? 'dark-' : ''}checks.txt`), checks.join('\n') + '\n');
  try { ws?.close(); } catch {}
  child.kill();
  const failed = checks.filter((c) => c.startsWith('FAIL')).length;
  console.log(`${checks.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
