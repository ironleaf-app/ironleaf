// node --test tests/t156-first-run.test.mjs — Vault's first run, walked as three new people (t156, 9 Nov 2026).
// t131 walked the former host app's first run but could not reach Vault's own first steps. Here, in Vault's
// headless renderer tests (the real bundle in Chromium, real clicks, the real main-side data layer), as:
//  1. someone with no notes at all: what they see first, the empty Today, the first note, the first project;
//  2. someone with an existing folder of 500 Markdown notes: opening it, nothing changed on disk without their
//     say, Today and the graph filling in;
//  3. someone importing a made-up zip export of another app (folders and attachments).
// Plus the vault choosing window (no vault open) and the Kit: the Templates page from Settings, and the brand kit.
// Pictures for each step go to $NV_FIRST_RUN_SHOTS (PNG, 1219x709, 1920x1117, 3456x1408); without it the walk
// still asserts everything, screenshots skipped. Test vaults only, cleaned after.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SHOTS = process.env.NV_FIRST_RUN_SHOTS || '';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

// ── Source checks: each fails without its fix ──────────────────────────────────

test('the setup card counts its steps honestly: the lead names how many rows follow', () => {
  const home = read('src/renderer/src/views/HomeView.tsx');
  const at = home.indexOf('export function SetupSteps');
  assert.ok(at > 0, 'SetupSteps is there');
  const body = home.slice(at, home.indexOf('</>', at) + 4);
  const rows = (body.match(/<div className="trow">/g) ?? []).length - 1; // the done row is not a step
  const m = /([A-Za-z]+) small steps/.exec(body);
  assert.ok(m, 'the lead names a step count');
  const words = { One: 1, Two: 2, Three: 3, Four: 4, Five: 5, Six: 6 };
  assert.equal(words[m[1]], rows, `the lead says ${m[1]} but ${rows} rows follow`);
});

test('a vault holding only the app’s own files reads as fresh, in one shared place', () => {
  const shared = read('src/shared/vault-place.ts');
  assert.ok(shared.includes('export function isFreshVault'), 'one fresh-vault rule, shared');
  assert.ok(shared.includes("WELCOME_NAME = 'Welcome to Ironleaf.md'"), 'the welcome note named once, shared');
  for (const f of ['src/renderer/src/views/HomeView.tsx', 'src/renderer/src/views/TodayView.tsx']) {
    const src = read(f);
    assert.ok(src.includes('isFreshVault'), `${f} reads the shared rule`);
    assert.ok(!src.includes('noteCount === 0'), `${f} no longer mistakes the welcome note and templates for the person’s`);
  }
  const main = read('src/main/vault-place.ts');
  assert.ok(!main.includes("WELCOME_NAME = 'Welcome to Ironleaf.md'"), 'no second copy of the name on the main side');
});

test('the welcome window names making a vault, as the folder window allows', () => {
  const src = read('src/renderer/src/components/Modals.tsx');
  const at = src.indexOf('export function Welcome');
  assert.ok(at > 0, 'Welcome is there');
  const body = src.slice(at, at + 2500);
  assert.ok(/make a new (one|folder|vault)/i.test(body), 'making is named beside choosing');
});

// ── The live walks: the real bundle, real clicks ──────────────────────────────

let Harness = null;
let X = null; // the extra real main code this walk needs: welcome, built-ins, import, project shape
const boots = [];
after(async () => {
  for (const b of boots.splice(0)) await b.close().catch(() => undefined);
});

before(async () => {
  Harness = await import('./vault-controls-harness.mjs');
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const dir = mkdtempSync(path.join(tmpdir(), 'nv-t156-core-'));
  boots.push({ close: async () => rmSync(dir, { recursive: true, force: true }) });
  const entry = path.join(dir, 'entry.ts');
  writeFileSync(
    entry,
    [
      `export { WELCOME_NOTE } from ${JSON.stringify(path.join(root, 'src/main/welcome.ts'))};`,
      `export { BUILT_INS, builtInPath } from ${JSON.stringify(path.join(root, 'src/main/templates.ts'))};`,
      `export { readImport, importInto, undoHomeImport } from ${JSON.stringify(path.join(root, 'src/main/vault-home.ts'))};`,
      `export { writeZip } from ${JSON.stringify(path.join(root, 'src/main/zip.ts'))};`,
      `export { projectFromTemplate } from ${JSON.stringify(path.join(root, 'src/shared/templates.ts'))};`,
      `export { projectsFolder, projectPath } from ${JSON.stringify(path.join(root, 'src/shared/project-file.ts'))};`,
    ].join('\n'),
  );
  const electron = { name: 'electron-stand-in', resolveId: (id) => (id === 'electron' ? '\0electron' : null), load: (id) => (id === '\0electron' ? 'export const shell = { trashItem: async () => {} }; export const app = { getPath: () => "", isPackaged: false };' : null) };
  await build({ input: entry, platform: 'node', plugins: [electron], output: { file: path.join(dir, 'x.mjs'), format: 'esm' }, logLevel: 'silent' });
  X = await import(pathToFileURL(path.join(dir, 'x.mjs')).href);
});

const put = (vaultDir, rel, data) => {
  const p = path.join(vaultDir, ...rel.split('/'));
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, data);
};
/** Every file under a folder with its SHA-256 (person 2: nothing changes without their say). */
function hashes(dir, skip = () => false) {
  const out = {};
  const walk = (rel) => {
    for (const e of readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (skip(r)) continue;
      if (e.isDirectory()) walk(r);
      else out[r] = createHash('sha256').update(readFileSync(path.join(dir, r))).digest('hex');
    }
  };
  walk('');
  return out;
}
/** A new vault as the app's first start makes it: the welcome note, the ready-made templates. */
function writeFreshVault(vaultDir) {
  put(vaultDir, 'Welcome to Ironleaf.md', X.WELCOME_NOTE);
  for (const b of X.BUILT_INS) put(vaultDir, X.builtInPath('Templates', b), b.text);
}

async function clickWords(h, words, scope = '') {
  return h.browser.ev(`(async () => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
    const root = ${scope ? `document.querySelector(${JSON.stringify(scope)})` : 'document'};
    if (!root) return 'NOROOT';
    const els = [...root.querySelectorAll('button, a[href], [role="button"], [role="tab"], .picker-row, input, textarea, [tabindex]')].filter(vis);
    // The shortest match wins (a page div with a tabindex holds every button's words; the button itself is the click).
    const matches = els
      .map((e) => ({ e, t: (e.innerText || e.getAttribute('aria-label') || e.title || e.getAttribute('placeholder') || '').replace(/\\s+/g, ' ') }))
      .filter(({ t }) => t.includes(${JSON.stringify(words)}))
      .sort((a, b) => a.t.length - b.t.length);
    if (!matches.length) return 'NOTFOUND';
    const el = matches[0].e;
    el.scrollIntoView({ block: 'nearest' });
    el.click();
    await new Promise((r) => setTimeout(r, 500));
    return 'CLICKED';
  })()`);
}
/** A real mouse click at a selector's middle (the editor needs the keys, not a .click()). */
async function clickSel(h, sel, n = 0) {
  const pt = await h.browser.ev(`(() => { const els = [...document.querySelectorAll(${JSON.stringify(sel)})].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2; }); const el = els[${n}]; if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  if (!pt) return 'NOTFOUND';
  const x = Math.round(pt.x), y = Math.round(pt.y);
  await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await h.browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  await sleep(400);
  return 'CLICKED';
}
const mainText = (h) => h.browser.ev(`document.querySelector('main')?.innerText ?? ''`);
const bodyText = (h) => h.browser.ev(`document.body.innerText ?? ''`);
const waitFor = async (h, js, ms = 12000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if (await h.browser.ev(js)) return true;
    } catch {}
    await sleep(400);
  }
  return false;
};
const dismiss = (h) => h.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
/** A page by its words, through the Ctrl+K list, as a person would. */
async function viaPalette(h, words, detail) {
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75 });
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75 });
  if (!(await waitFor(h, `!!document.querySelector('.picker input')`, 6000))) return 'NOPALETTE';
  await h.browser.send('Input.insertText', { text: words });
  await sleep(900);
  const picked = await h.browser.ev(`(() => {
    const rows = [...document.querySelectorAll('.picker-row')];
    const text = (r, sel) => r.querySelector(sel)?.innerText.trim() ?? '';
    const row = rows.find((r) => text(r, '.picker-label') === ${JSON.stringify(words)}${detail ? ` && text(r, '.picker-detail') === ${JSON.stringify(detail)}` : ''}) ?? rows.find((r) => (text(r, '.picker-label') || '').includes(${JSON.stringify(words)}));
    if (!row) return 'NOTFOUND:' + rows.map((r) => text(r, '.picker-label')).slice(0, 8).join('|');
    row.click();
    return 'CLICKED';
  })()`);
  await sleep(900);
  return picked;
}
const SIZES = [[1219, 709], [1920, 1117], [3456, 1408]];
async function shot(h, name) {
  if (!SHOTS) return;
  for (const [w, hh] of SIZES) {
    await h.browser.send('Emulation.setDeviceMetricsOverride', { width: w, height: hh, deviceScaleFactor: 2, mobile: false });
    await sleep(900);
    const d = await h.browser.send('Page.captureScreenshot', { format: 'png' });
    if (d.result?.data) writeFileSync(path.join(SHOTS, `${name}-${w}x${hh}.png`), Buffer.from(d.result.data, 'base64'));
  }
  await h.browser.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await sleep(600);
}

/**
 * One booted Vault: the real services over a test vault, with the walk's extras. `wrap` sees each RPC and may
 * answer it (the OS folder windows, which cannot open headless, and the project/workspace file, kept in memory).
 * `startNull` boots with no vault open, for the choosing window.
 */
async function boot(write, { wrap = null, startNull = false, recentVaults = null } = {}) {
  const work = mkdtempSync(path.join(tmpdir(), 'nv-t156-'));
  const vaultDir = path.join(work, 'vault');
  mkdirSync(vaultDir, { recursive: true });
  await write(vaultDir, work);
  const core = await Harness.loadCore(work);
  const distDir = await Harness.buildRenderer(work);
  const box = { current: await Harness.openServices(vaultDir, path.join(work, 'data'), core, { realChecks: true }) };
  const info = { path: vaultDir, name: path.basename(vaultDir), library: true };
  let picked = !startNull;
  const mem = new Map(); // project workspace texts (the app keeps them in its own data folder)
  let pendingImport = null;
  const services = {
    get vault() { return box.current.vault; },
    get index() { return box.current.index; },
    log: (...a) => box.current.log(...a),
    invoke: async (channel, args) => {
      const a = Array.isArray(args) ? args : [];
      if (channel === 'vault:current') return picked ? info : null;
      if (channel === 'vault:pick' || channel === 'vault:open') {
        if (channel === 'vault:open' && typeof a[0] === 'string' && a[0] !== vaultDir && !existsSync(a[0])) throw new Error('That folder isn’t there any more.');
        picked = true;
        return info;
      }
      if (channel === 'settings:get' && recentVaults) return { ...(await box.current.invoke(channel, a)), recentVaults };
      // A project made by hand (the app's own steps, src/main/app.ts createProject): its folder by the same rule,
      // its file shaped by the chosen template, never over one already there.
      if (channel === 'project:create') {
        const title = typeof a[0] === 'string' ? a[0].trim().slice(0, 120) : '';
        if (!title) throw new Error('Give the project a name.');
        const top = (await box.current.vault.listAll()).folders.filter((f) => !f.includes('/'));
        const area = typeof a[3] === 'string' && a[3].trim() ? `${a[3].trim().replace(/\\/g, '/')}/Projects` : X.projectsFolder(top);
        const file = X.projectPath(area, title);
        if (await box.current.vault.any(file)) throw new Error('A project with that name is already there.');
        const shape = typeof a[2] === 'string' && a[2] ? await box.current.vault.read(a[2]) : '';
        const made = X.projectFromTemplate(shape, { name: title, title, today: new Date().toISOString().slice(0, 10) });
        const dir = file.slice(0, file.lastIndexOf('/'));
        if (dir && !(await box.current.vault.any(dir))) await box.current.vault.makeFolder(dir);
        await box.current.vault.create(file, made.text);
        await box.current.rescan(file);
        return file;
      }
      if (channel === 'workspace:save') return void mem.set(String(a[0]), String(a[1] ?? ''));
      if (channel === 'workspace:load') return mem.get(String(a[0])) ?? '';
      // Browsing a foreign folder (person 2): adopting is offered, and the button's whole path runs — the channel,
      // the switch and the toast. The switch itself is the app's (this vault already is the library here); its
      // no-silent-writes and ask-once rules are proven main-side by u3-movein.test.mjs.
      if (wrap?.adoptable && channel === 'place:status') return { ...(await box.current.invoke(channel, a)), adoptable: true };
      if (wrap?.adoptable && channel === 'place:adopt-open') return info;
      // Import (the real read, plan, merge and take-back, src/main/vault-home.ts): only the OS file window is
      // doubled — the walk stages its zip, as if the person had picked it.
      if (channel === 'home:import-pick' && wrap?.importSource) {
        if (pendingImport) await pendingImport.done().catch(() => undefined);
        pendingImport = await X.readImport(wrap.importSource, vaultDir, { tempDir: path.join(work, 'import-temp') });
        return pendingImport.plan;
      }
      if (channel === 'home:import' && pendingImport) {
        const summary = await X.importInto(vaultDir, pendingImport, { targetIsNew: false });
        await pendingImport.done().catch(() => undefined);
        pendingImport = null;
        await box.current.rescanAll();
        return summary;
      }
      if (channel === 'home:import-cancel' && pendingImport) {
        await pendingImport.done().catch(() => undefined);
        pendingImport = null;
        return undefined;
      }
      if (channel === 'home:import-undo') {
        const back = await X.undoHomeImport(vaultDir, String(a[0]), { trash: async (rel) => box.current.invoke('path:trash', [rel]) });
        await box.current.rescanAll();
        return back;
      }
      if (wrap?.onChannel) {
        const answered = await wrap.onChannel(channel, a, { box, info, work, vaultDir });
        if (answered !== undefined) return answered;
      }
      return box.current.invoke(channel, a);
    },
  };
  const server = await Harness.startServer(distDir, () => services);
  const browser = await Harness.startBrowser(server.origin);
  const h = { work, vaultDir, browser, server, services, close: async () => { browser.close(); server.close(); rmSync(work, { recursive: true, force: true }); } };
  boots.push(h);
  for (let i = 0; i < 90; i++) {
    await sleep(500);
    try {
      if (await browser.ev(`!!document.querySelector('.app, .welcome')`)) break;
    } catch {}
  }
  await sleep(2500);
  return h;
}

// ── The choosing window (no vault open) ───────────────────────────────────────

test('choosing: plain words with one clear next step, a dead recent said honestly, choosing opens', async () => {
  const h = await boot((v) => writeFreshVault(v), { startNull: true, recentVaults: [path.join(tmpdir(), 'nv-t156-gone-no-such-folder')] });
  assert.ok(await waitFor(h, `!!document.querySelector('.welcome')`), 'the choosing window shows');
  const words = await bodyText(h);
  assert.ok(words.includes('Ironleaf'), 'it names itself');
  assert.doesNotMatch(words, /couldn’t open/, 'no failure claim with no failure known');
  assert.match(words, /Choose a folder of notes/, 'one clear next step');
  assert.match(words, /make a new/i, 'making is named too');
  await shot(h, 't156-welcome');
  // A recent folder that is gone: said honestly, still on the window.
  assert.equal(await clickWords(h, 'nv-t156-gone-no-such-folder'), 'CLICKED', 'the dead recent clicks');
  assert.ok(await waitFor(h, `document.body.innerText.includes('isn’t there any more')`), 'the dead recent is said honestly');
  assert.ok(await h.browser.ev(`!!document.querySelector('.welcome')`), 'still choosing, not stranded');
  // Choosing opens the vault.
  assert.equal(await clickWords(h, 'Choose a folder of notes'), 'CLICKED', 'choosing clicks');
  assert.ok(await waitFor(h, `!!document.querySelector('.app')`, 20000), 'the vault opens');
  // Every genuine greeting (Working late past midnight, never only the day's three) and the empty line as
  // it reads now — the wait holds whatever hour the suite runs.
  assert.ok(await waitFor(h, `/Today|Working late|Good morning|Good afternoon|Good evening|Nothing needs you/.test(document.querySelector('main')?.innerText ?? '')`, 20000), 'lands on the morning place (got: ' + (await mainText(h)).slice(0, 200) + ')');
});

// ── Person 1: no notes at all ─────────────────────────────────────────────────

test('person 1 sees the setup steps first, on an honest empty Today', async () => {
  const h = await boot((v) => writeFreshVault(v));
  assert.ok(await waitFor(h, `!!document.querySelector('.app')`), 'the app boots');
  await sleep(1500);
  const words = await mainText(h);
  assert.ok(words.includes('Four small steps') || words.includes('Five small steps'), 'the setup steps show on a new vault (got: ' + words.slice(0, 300) + ')');
  assert.match(words, /Write your first note/, 'the first step writes');
  const toToday = async () => {
    assert.equal(await clickWords(h, 'Today', '.places-list'), 'CLICKED', 'back to Today');
    await sleep(1200);
  };
  // Every step's button is there and works (Capture's window cannot open headless: presence only).
  for (const button of ['New note', 'Capture', 'Packs', 'Open', 'Start']) {
    assert.equal(await h.browser.ev(`[...document.querySelectorAll('main button')].some((b) => (b.innerText || '').trim() === ${JSON.stringify(button)} && !b.disabled)`), true, `${button} is offered`);
  }
  assert.equal(await clickWords(h, 'Packs'), 'CLICKED', 'Packs opens');
  assert.ok(await waitFor(h, `document.body.innerText.includes('Packs')`), 'Settings › Packs lands');
  await toToday();
  assert.equal(await clickWords(h, 'Open'), 'CLICKED', 'Open opens');
  assert.ok(await waitFor(h, `document.body.innerText.includes('What the Vault can do')`, 15000), 'the abilities land (got: ' + (await mainText(h)).slice(0, 150) + ')');
  await toToday();
  assert.equal(await clickWords(h, 'Start'), 'CLICKED', 'Start opens');
  assert.ok(await waitFor(h, `!!document.querySelector('.overlay, .picker, [role="dialog"]')`, 10000), 'the starter picker opens');
  await dismiss(h);
  await sleep(600);
  await toToday();
  await shot(h, 't156-p1-today-setup');
});

test('person 1’s first note: made from the steps, written in, kept on disk', async () => {
  const h = await boot((v) => writeFreshVault(v));
  assert.ok(await waitFor(h, `!!document.querySelector('.app')`), 'the app boots');
  assert.equal(await clickWords(h, 'New note'), 'CLICKED', 'New note clicks');
  assert.ok(await waitFor(h, `!!document.querySelector('.cm-content')`, 15000), 'the note opens for writing');
  const lines = await h.browser.ev(`document.querySelectorAll('.cm-content .cm-line').length`);
  assert.ok(lines > 0, 'lines are drawn to click');
  assert.equal(await clickSel(h, '.cm-content .cm-line', lines - 1), 'CLICKED', 'the mouse lands in the note');
  assert.equal(await h.browser.ev(`!!document.querySelector('.cm-editor')?.contains(document.activeElement)`), true, 'the keys are in the note');
  await h.browser.send('Input.insertText', { text: 'The kitchen refit starts Monday. Benches first, then the splashback.' });
  await sleep(2500);
  await shot(h, 't156-p1-first-note');
  const disk = readdirSync(h.vaultDir).filter((f) => f.endsWith('.md'));
  const mine = disk.find((f) => f !== 'Welcome to Ironleaf.md');
  assert.ok(mine, 'the note is a file in the vault (' + disk.join(', ') + ')');
  assert.match(readFileSync(path.join(h.vaultDir, mine), 'utf8'), /kitchen refit starts Monday/, 'their words are in it');
});

test('person 1’s first project: named, made, shown where it lives', async () => {
  const h = await boot((v) => writeFreshVault(v));
  assert.ok(await waitFor(h, `!!document.querySelector('.app')`), 'the app boots');
  assert.equal(await clickWords(h, 'Projects', '.places-list'), 'CLICKED', 'Projects opens');
  await sleep(1500);
  assert.match(await mainText(h), /Your projects, in one place/, 'the empty Projects reads plainly');
  const r = await clickWords(h, 'One project by hand');
  assert.equal(r, 'CLICKED', 'One project by hand clicks (got: ' + r + '; ' + (await mainText(h)).slice(0, 200) + ')');
  assert.ok(await waitFor(h, `!!document.querySelector('.np-dialog')`), 'the dialog opens');
  await h.browser.send('Input.insertText', { text: 'Kitchen Refit' });
  await sleep(500);
  assert.equal(await clickWords(h, 'Make the project', '.np-dialog'), 'CLICKED', 'making clicks');
  assert.ok(await waitFor(h, `document.body.innerText.includes('Kitchen Refit') && !document.querySelector('.np-dialog')`, 15000), 'the project lands');
  await sleep(1200);
  await shot(h, 't156-p1-first-project');
  const file = path.join(h.vaultDir, 'Projects', 'Kitchen Refit', 'Kitchen Refit.md');
  assert.ok(existsSync(file), 'the project is a file where projects live');
  assert.match(readFileSync(file, 'utf8'), /type: project/, 'it is a project file');
  assert.match(await mainText(h), /Kitchen Refit/, 'the page shows it');
});

// ── Person 2: an existing folder of 500 Markdown notes ────────────────────────

/** Plain Markdown as another notes app leaves it: folders, front matter, [[links]], attachments. */
function writeLivedIn(vaultDir) {
  const topics = ['Sourdough', 'Balcony garden', 'Inverter batteries', 'Camping list', 'Book notes', 'Meeting minutes'];
  for (let i = 1; i <= 500; i++) {
    const topic = topics[i % topics.length];
    const folder = i % 5 === 0 ? 'Journal' : i % 7 === 0 ? 'Work' : 'Notes';
    const next = (i % 500) + 1;
    const task = i % 40 === 0 ? `\n- [ ] Chase the quote for note ${i} — due 2026-11-05\n` : i % 33 === 0 ? `\n- [x] File the receipt for note ${i}\n` : '';
    put(vaultDir, `${folder}/Note ${i} about ${topic}.md`, `---\ntags: [${topic.toLowerCase().replace(/ /g, '-')}, kept]\ncreated: 2025-${String((i % 12) + 1).padStart(2, '0')}-10\n---\n# Note ${i} about ${topic}\n\nKept from the old app. It links to [[Note ${next} about ${topics[next % topics.length]}]] and back.${task}\n`);
  }
  put(vaultDir, 'Notes/Seed sketch.md', '# Seed sketch\n\n![rows](Attachments/rows.png)\n');
  put(vaultDir, 'Attachments/rows.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]));
}

test('person 2 is welcomed with what was found, and browsing changes nothing on disk', async () => {
  const before = {};
  const h = await boot(
    async (v) => {
      writeLivedIn(v);
      Object.assign(before, hashes(v));
    },
    { wrap: { adoptable: true } },
  );
  assert.ok(await waitFor(h, `!!document.querySelector('.app')`), 'the app boots');
  // Today's moving-in card: what was found, with doors into it, nothing renamed or moved.
  assert.ok(await waitFor(h, `document.body.innerText.includes('Your notes, moved in')`, 20000), 'the moving-in card shows (got: ' + (await mainText(h)).slice(0, 250) + ')');
  const words = await mainText(h);
  assert.match(words, /501 notes/, 'it counts the notes honestly');
  assert.match(words, /Nothing renamed, moved or rewritten/, 'it promises restraint');
  assert.equal(await clickWords(h, 'Make this my vault'), 'CLICKED', 'adopting clicks');
  assert.ok(await waitFor(h, `document.body.innerText.includes('is your vault now')`, 10000), 'adopting is said');
  await shot(h, 't156-p2-today-moving-in');
  // A walk through: Notes, a note, Tasks.
  assert.equal(await clickWords(h, 'Notes', '.places-list'), 'CLICKED', 'Notes opens');
  await sleep(1800);
  assert.match(await mainText(h), /Note 1 about/, 'their notes list');
  assert.equal(await h.browser.ev(`(() => { const row = [...document.querySelectorAll('main .trow.w2b-row')].find((r) => (r.innerText || '').includes('Note 1 about')); if (!row) return 'NOTFOUND'; row.click(); return 'CLICKED'; })()`), 'CLICKED', 'a note opens');
  assert.ok(await waitFor(h, `(document.querySelector('main')?.innerText ?? '').includes('Kept from the old app')`, 15000), 'it reads as they left it (got: ' + (await mainText(h)).slice(0, 300) + ')');
  const tasksAt = await clickWords(h, 'Tasks', '.places-list');
  assert.equal(tasksAt, 'CLICKED', 'Tasks opens');
  await sleep(1500);
  assert.match(await mainText(h), /Chase the quote/, 'their open tasks show');
  assert.deepEqual(hashes(h.vaultDir), before, 'browsing changed nothing on disk');
});

test('person 2’s Today and graph fill in from their notes', async () => {
  const h = await boot((v) => writeLivedIn(v));
  assert.ok(await waitFor(h, `!!document.querySelector('.app')`), 'the app boots');
  await sleep(2000);
  assert.equal(await clickWords(h, 'Today', '.places-list'), 'CLICKED', 'Today opens');
  await sleep(2500);
  // Today orients around projects and the day (their tick-boxes live on the Tasks page, a door away on the
  // moving-in card): what fills here is the card, and the day's activity from their notes.
  assert.match(await mainText(h), /Your notes, moved in/, 'the moving-in card is on Today (got: ' + (await mainText(h)).slice(0, 300) + ')');
  const todayWords = await mainText(h);
  assert.doesNotMatch(todayWords, /Nothing on you yet/, 'no empty-vault block over a full one');
  assert.doesNotMatch(await mainText(h), /small steps/, 'no setup steps over a full vault');
  await shot(h, 't156-p2-today-filled');
  const nodes = await h.browser.ev(`window.nv.index.graph().then((g) => (g.nodes || g.dots || []).length)`);
  assert.ok(nodes > 100, `the graph holds their notes (${nodes} nodes)`);
  assert.equal(await viaPalette(h, 'Open the graph'), 'CLICKED', 'the graph opens');
  await sleep(2500);
  assert.equal(await h.browser.ev(`!!document.querySelector('canvas, .graph-view, svg')`), true, 'the graph draws');
  await shot(h, 't156-p2-graph');
});

// ── Person 3: a zip export of another app ─────────────────────────────────────

test('person 3 brings a zip export in: plan first, originals kept, take-back offered', async () => {
  let staged = '';
  const h = await boot(
    async (v, work) => {
      writeFreshVault(v);
      // A made-up export of another app: folders, Markdown, a web page, a spreadsheet, attachments.
      const exp = path.join(work, 'export-src', 'Keep export');
      mkdirSync(path.join(exp, 'Trip plan_files'), { recursive: true });
      writeFileSync(path.join(exp, 'Trip plan.html'), '<!doctype html><html><head><title>Trip plan</title></head><body><h2>Flights</h2><p>Qantas <b>QF1</b> on Friday.</p><ul><li>Passport</li></ul><p><img src="Trip plan_files/map.png" alt="Map"></p></body></html>');
      writeFileSync(path.join(exp, 'Trip plan_files', 'map.png'), Buffer.from([1, 2, 3, 4]));
      writeFileSync(path.join(exp, 'Contacts.csv'), 'Name,Phone\nAna,0400 000 000\nTom,0411 111 111\n');
      writeFileSync(path.join(exp, 'Shopping.md'), '# Shopping\n\n- Milk\n- Bread\n');
      mkdirSync(path.join(exp, 'Journal'), { recursive: true });
      writeFileSync(path.join(exp, 'Journal', 'First day.md'), '# First day\n\nWe landed at noon.\n');
      staged = path.join(work, 'keep-export.zip');
      const { zipFolder } = await import('./zip-folder.mjs');
      zipFolder(staged, exp);
    },
    { wrap: { get importSource() { return staged; } } },
  );
  assert.ok(await waitFor(h, `!!document.querySelector('.app')`), 'the app boots');
  assert.equal(await viaPalette(h, 'Import: emails, PDFs, CSV spreadsheets, notes and folders'), 'CLICKED', 'Import opens');
  await sleep(1500);
  assert.match(await mainText(h), /Bring outside stuff in/, 'the Import page reads plainly');
  assert.equal(await clickWords(h, 'Copy in'), 'CLICKED', 'Copy in opens the dialog');
  assert.ok(await waitFor(h, `document.body.innerText.includes('A vault export (.zip)')`), 'the ways to import show');
  assert.equal(await clickWords(h, 'A vault export (.zip)'), 'CLICKED', 'the zip way clicks');
  assert.ok(await waitFor(h, `document.body.innerText.includes('Bring in') && document.body.innerText.includes('Import')`, 30000), 'the plan shows first (got: ' + (await bodyText(h)).slice(0, 300) + ')');
  assert.match(await bodyText(h), /keep-export/, 'the plan names what comes');
  await shot(h, 't156-p3-import-plan');
  assert.equal(await clickWords(h, 'Import', '[role="dialog"], .dialog, .vh-dialog'), 'CLICKED', 'Import clicks');
  assert.ok(await waitFor(h, `document.body.innerText.includes('Nothing was renamed or lost')`, 60000), 'the summary reads plainly');
  assert.match(await bodyText(h), /Undo/, 'the take-back is offered');
  await shot(h, 't156-p3-import-done');
  const into = readdirSync(h.vaultDir).find((d) => /keep/i.test(d) && statSync(path.join(h.vaultDir, d)).isDirectory());
  assert.ok(into, 'its own folder holds the import (' + readdirSync(h.vaultDir).join(', ') + ')');
  assert.ok(existsSync(path.join(h.vaultDir, into, 'Trip plan.md')), 'the page became a note');
  assert.ok(existsSync(path.join(h.vaultDir, into, 'Trip plan.html')), 'the original kept beside it');
  assert.ok(existsSync(path.join(h.vaultDir, into, 'Shopping.md')), 'Markdown kept as a note');
  // Taking it back from the dialog: the notes leave for the Bin, recoverable.
  assert.equal(await clickWords(h, 'Undo'), 'CLICKED', 'Undo clicks');
  assert.ok(await waitFor(h, `document.body.innerText.includes('Bin')`, 30000), 'the take-back is said');
  assert.ok(!existsSync(path.join(h.vaultDir, into, 'Shopping.md')), 'the notes left');
});

// ── The Kit: templates and the brand kit, from Settings ───────────────────────

test('the Kit: Templates opens from Settings and a template makes a note', async () => {
  const h = await boot((v) => writeFreshVault(v));
  assert.ok(await waitFor(h, `!!document.querySelector('.app')`), 'the app boots');
  assert.equal(await Harness.openSettings(h), 'CLICKED', 'Settings opens');
  assert.ok(await waitFor(h, `document.body.innerText.includes('Types and templates')`, 15000), 'Settings › General lands');
  assert.equal(await h.browser.ev(`(() => { const row = document.querySelector('main .setting-row[data-setting="Templates"]'); const b = [...(row?.querySelectorAll('button') ?? [])].find((x) => (x.innerText || '').trim() === 'Open'); if (!b) return 'NOTFOUND'; b.click(); return 'CLICKED'; })()`), 'CLICKED', 'Templates Open clicks');
  assert.ok(await waitFor(h, `document.body.innerText.includes('Meeting notes')`, 15000), 'the Templates page lists the ready-made ones');
  await shot(h, 't156-kit-templates');
  assert.equal(await h.browser.ev(`(() => { const b = [...document.querySelectorAll('button.w4b-tp-name')].find((x) => (x.innerText || '').includes('Meeting notes')); if (!b) return 'NOTFOUND'; b.click(); return 'CLICKED'; })()`), 'CLICKED', 'a template previews');
  // The preview's own words, seen (the pane beside the list, or the sheet when that pane is folded away).
  assert.ok(await waitFor(h, `document.body.innerText.includes('As it would be made today')`, 10000), 'the preview shows as made today');
  assert.equal(await clickWords(h, 'Use', '.tp-preview'), 'CLICKED', 'Use clicks');
  await sleep(2500);
  const made = await h.browser.ev(`[...document.querySelectorAll('.tab, [role="tab"]')].map((t) => t.innerText).join(' ')`);
  assert.match(String(made) + (await bodyText(h)), /Meeting notes/, 'the note is made from it');
});

test('the Kit: the brand kit opens and keeps a name and colours', async () => {
  const h = await boot((v) => writeFreshVault(v));
  assert.ok(await waitFor(h, `!!document.querySelector('.app')`), 'the app boots');
  assert.equal(await viaPalette(h, 'Open your brand kit'), 'CLICKED', 'the brand kit opens');
  assert.ok(await waitFor(h, `document.body.innerText.includes('Brand kit')`, 15000), 'the brand kit page lands');
  await shot(h, 't156-kit-brand-empty');
  // A business name, kept when the field is left.
  assert.equal(await h.browser.ev(`(() => { const i = [...document.querySelectorAll('input, textarea')].find((e) => (e.getAttribute('placeholder') || '').includes('business')); if (!i) return 'NOTFOUND'; i.focus(); i.click(); return 'CLICKED'; })()`), 'CLICKED', 'the name field focuses');
  await h.browser.send('Input.insertText', { text: 'Harbour Pine' });
  await sleep(400);
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await sleep(1500);
  const brand = await h.browser.ev(`window.nv.assets.list().then((l) => l.brand?.name ?? null)`);
  assert.equal(brand, 'Harbour Pine', 'the name is kept');
  // A colour by its hex code.
  assert.equal(await h.browser.ev(`(() => { const i = [...document.querySelectorAll('input')].find((e) => (e.getAttribute('aria-label') || '').includes('hex')); if (!i) return 'NOTFOUND'; i.focus(); i.select(); return 'CLICKED'; })()`), 'CLICKED', 'the hex field focuses');
  await sleep(300);
  await h.browser.send('Input.insertText', { text: '#1D4E89' });
  await sleep(400);
  assert.equal(await clickWords(h, 'Add colour'), 'CLICKED', 'Add colour clicks');
  await sleep(1500);
  const colours = await h.browser.ev(`window.nv.assets.list().then((l) => (l.brand?.colours ?? []).map((c) => c.hex).join(','))`);
  assert.match(String(colours), /#1D4E89/i, 'the colour is kept');
  await shot(h, 't156-kit-brand-kept');
});
