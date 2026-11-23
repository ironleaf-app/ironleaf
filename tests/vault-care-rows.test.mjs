// node --test tests/vault-care-rows.test.mjs — p11 vault-care (Nov 2026: the project's Tasks tab is
// "horrible to look at"): ONE row mechanism every task list uses — the project's What's next
// section (the Tasks tab until the 5 Nov 2026 folio), the Tasks page, Today rows, meeting actions.
// Fixed columns (tick | title | who | when), who and when sharing one x on every row; the same task
// in two sections shows once (Waiting wins); "Open" says nothing and is dropped; "Show as" is the
// shared segmented control. The live harness (tests/vault-controls-harness.mjs) boots the real
// renderer bundle in headless Chromium against the vault-care vault (tests/vault-care-vault.mjs: a
// project with 37 long tasks, 23 notes, 57 files, 12 people). Fails first on the scattered rows (no
// .tkrow cells at all).
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildRenderer, loadCore, openServices, startBrowser, startServer } from './vault-controls-harness.mjs';
import { CARE_PEOPLE, writeCareVault } from './vault-care-vault.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── the one-row reading, pure (components/plan/plan.ts) ─────────────────────────
let P;
let PF;
before(async () => {
  const work = mkdtempSync(path.join(tmpdir(), 'nv-care-plan-'));
  try {
    const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
    const entry = path.join(work, 'entry.ts');
    writeFileSync(entry, `export * as P from ${JSON.stringify(path.join(root, 'src/renderer/src/components/plan/plan.ts'))};\nexport * as PF from ${JSON.stringify(path.join(root, 'src/shared/project-file.ts'))};\n`);
    await build({ input: entry, platform: 'node', output: { file: path.join(work, 'plan.mjs'), format: 'esm' }, logLevel: 'silent' });
    ({ P, PF } = await import(pathToFileURL(path.join(work, 'plan.mjs')).href));
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test('who shows the first name, the full name on hover', () => {
  assert.equal(P.firstNameOf('Jesse Arlow'), 'Jesse');
  assert.equal(P.firstNameOf('  Mia   Tran  '), 'Mia');
  assert.equal(P.firstNameOf('Tessaly'), 'Tessaly');
});

test('an owner written in the title moves to who (display only): trailing dash plus a name', () => {
  assert.deepEqual(P.splitTitleOwner('Confirm call attendance - Jack Doyle'), { title: 'Confirm call attendance', owner: 'Jack Doyle' });
  assert.deepEqual(P.splitTitleOwner('Send the plan — Sarah Kim'), { title: 'Send the plan', owner: 'Sarah Kim' });
  // Not a name, not a tail: the words stay whole.
  assert.deepEqual(P.splitTitleOwner('Talk to Sarah about the tenancy'), { title: 'Talk to Sarah about the tenancy' });
  assert.deepEqual(P.splitTitleOwner('Decide the vendor (RACI row: choice still open)'), { title: 'Decide the vendor (RACI row: choice still open)' });
  assert.deepEqual(P.splitTitleOwner('Ask Zoe for the schedule so the-carpenters can start'), { title: 'Ask Zoe for the schedule so the-carpenters can start' });
  assert.deepEqual(P.splitTitleOwner('File it - urgent'), { title: 'File it - urgent' });
  assert.deepEqual(P.splitTitleOwner('Call TO'), { title: 'Call TO' });
});

test('when reads coral for late alone, quiet for today and future; "Open" says nothing', () => {
  // 5 Nov 2026, the plan: "Today" reads muted with the future, only late asks in attention.
  assert.equal(P.whenTone(-5), 'coral');
  assert.equal(P.whenTone(-1), 'coral');
  assert.equal(P.whenTone(0), 'quiet');
  assert.equal(P.whenTone(9), 'quiet');
  assert.equal(P.whenTone(null), null);
  assert.equal(P.stateReading('Open'), null);
  assert.equal(P.stateReading('open'), null);
  assert.equal(P.stateReading('  '), null);
  assert.deepEqual(P.stateReading('Ongoing'), { words: 'Ongoing' });
  assert.deepEqual(P.stateReading('Waiting'), { words: 'Waiting' });
});

test('Waiting wins: next steps shadowed by the same ref, exact identity only', () => {
  const shadowed = P.shadowedNextIndexes([{ ref: { kind: 'next', index: 4 } }, { ref: { kind: 'record', id: 'x' } }]);
  assert.ok(shadowed.has(4));
  assert.equal(shadowed.size, 1);
});

// ── the rows on screen, measured ────────────────────────────────────────────────
let H = null;
async function harness() {
  if (H) return H;
  const work = mkdtempSync(path.join(tmpdir(), 'nv-care-rows-'));
  const vaultDir = path.join(work, 'vault');
  mkdirSync(vaultDir, { recursive: true });
  writeCareVault(vaultDir);
  const core = await loadCore(work);
  mkdirSync(path.join(work, 'data'), { recursive: true });
  const services = await openServices(vaultDir, path.join(work, 'data'), core);
  const distDir = await buildRenderer(work);
  const server = await startServer(distDir, () => services);
  const browser = await startBrowser(server.origin);
  H = { work, vaultDir, browser, server, close: async () => { browser.close(); server.close(); rmSync(work, { recursive: true, force: true }); } };
  return H;
}
after(async () => {
  if (H) await H.close();
  H = null;
});

async function waitFor(h, js, ms = 20000) {
  const t0 = Date.now();
  for (;;) {
    try {
      if (await h.browser.ev(js)) return;
    } catch {}
    if (Date.now() - t0 > ms) throw new Error(`waitFor timed out: ${js.slice(0, 120)}`);
    await sleep(300);
  }
}

async function clickWords(h, words, scope = '') {
  const r = await h.browser.ev(`(async () => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
    const root = ${scope ? `document.querySelector(${JSON.stringify(scope)})` : 'document'};
    if (!root) return 'NOROOT';
    const sel = 'button, a[href], select, input, textarea, [role="button"], [role="tab"], [role="menuitem"], [role="checkbox"], [role="switch"], [role="radio"], summary';
    const els = [...root.querySelectorAll(sel)].filter(vis);
    const el = els.find((e) => ((e.innerText || e.getAttribute('aria-label') || e.title || '').replace(/\\s+/g, ' ').includes(${JSON.stringify(words)})));
    if (!el) return 'NOTFOUND';
    el.scrollIntoView({ block: 'nearest' });
    el.click();
    await new Promise((r) => setTimeout(r, 500));
    return 'CLICKED';
  })()`);
  assert.equal(r, 'CLICKED', `click ${JSON.stringify(words)} in ${JSON.stringify(scope)}`);
}

async function openProject(h) {
  await clickWords(h, 'Projects', '.side');
  await waitFor(h, `!![...document.querySelectorAll('main h1, .main h1')].some((e) => e.innerText.includes('Projects'))`);
  await sleep(800);
  await clickWords(h, 'Brisbane Depot Refit', 'main');
  await waitFor(h, `!!document.querySelector('.pj-page')`);
  await sleep(1000);
}

/** Open every "Show all" fold in a folio section (folded rows are not in the page at all). */
async function expandFolds(h, section) {
  await h.browser.ev(`[...document.querySelectorAll('[data-section="${section}"] .pj-showall')].filter((b) => (b.innerText || '').startsWith('Show all') || (b.innerText || '').startsWith('All ')).forEach((b) => b.click())`);
  await sleep(600);
}

/** Every .tkrow-who shares one x and every .tkrow-when shares one x (within a pixel). */
async function assertColumns(h, scope, minRows) {
  const xs = await h.browser.ev(`(() => {
    const root = document.querySelector(${JSON.stringify(scope)}) || document;
    const x = (sel) => [...root.querySelectorAll(sel)].filter((el) => el.getBoundingClientRect().width > 2).map((el) => Math.round(el.getBoundingClientRect().x));
    return { who: x('.tkrow-who'), when: x('.tkrow-when') };
  })()`);
  assert.ok(xs.who.length >= minRows, `${scope}: ${xs.who.length} who cells, want ${minRows}`);
  assert.ok(xs.when.length >= minRows, `${scope}: ${xs.when.length} when cells, want ${minRows}`);
  assert.ok(Math.max(...xs.who) - Math.min(...xs.who) <= 1, `${scope}: who scatters ${Math.min(...xs.who)}..${Math.max(...xs.who)}`);
  assert.ok(Math.max(...xs.when) - Math.min(...xs.when) <= 1, `${scope}: when scatters ${Math.min(...xs.when)}..${Math.max(...xs.when)}`);
  return xs;
}

test("project Your next section: who and when share one x on every row", async () => {
  const h = await harness();
  await waitFor(h, `!!document.querySelector('.app')`, 30000);
  await sleep(1200);
  await openProject(h);
  // t255: the folio reads through tabs; the rows stand on their tab.
  await clickWords(h, 'Your next', '.pt-bar[role="tablist"]');
  await sleep(800);
  await expandFolds(h, 'whats-next');
  await assertColumns(h, '[data-section="whats-next"]', 10);
}, { timeout: 180000 });

test("project folio: the same task shows once, Waiting wins; no bare \"Open\"", async () => {
  const h = await harness();
  await expandFolds(h, 'waiting');
  // Rows past the fold skip rendering until scrolled to (t102's content-visibility speed work), so their
  // innerText reads empty — read each row as a person would, scrolled into view (t142's project-page fix).
  await h.browser.ev(`(async () => {
    for (const e of document.querySelectorAll('.pj-folio .tkrow')) { e.scrollIntoView({ block: 'center' }); await new Promise((r) => setTimeout(r, 60)); }
  })()`);
  await sleep(400);
  const dup = 'Ava answers the wholesaler eight challenge questions';
  const found = await h.browser.ev(`(() => {
    const rows = [...document.querySelectorAll('.pj-folio .tkrow')];
    const hits = rows.filter((r) => (r.innerText || '').includes(${JSON.stringify(dup)}));
    return hits.map((r) => r.closest('[data-section]')?.getAttribute('data-section') ?? '');
  })()`);
  assert.equal(found.length, 1, `the task shows ${found.length} times, want once`);
  assert.equal(found[0], 'waiting', 'Waiting wins');
  const open = await h.browser.ev(`(() => [...document.querySelectorAll('.pj-folio .tkrow-when')].map((el) => el.innerText.trim()))()`);
  assert.ok(open.length > 0, 'when cells exist');
  assert.ok(!open.some((t) => t === 'Open'), 'no bare "Open" in the when column');
  // Leave the page as it was found: the walk above ends at the folio's foot, later tests read its head.
  await h.browser.ev(`document.querySelector('[data-section="whats-next"]')?.scrollIntoView({ block: 'start' })`);
  await sleep(400);
}, { timeout: 120000 });

test("project Your next section: one flat list, no view switch, in the reading column", async () => {
  // Step 2 (their decision 2: one view per list): no Rows, Board, Calendar or Timeline switch, no calendar
  // grid.
  const h = await harness();
  assert.ok(!(await h.browser.ev(`!!document.querySelector('[data-section="whats-next"] .seg')`)), 'no Show-as switch');
  assert.ok(!(await h.browser.ev(`!!document.querySelector('[data-section="whats-next"] .cal')`)), 'no calendar grid');
  const rows = await h.browser.ev(`document.querySelectorAll('[data-section="whats-next"] .tkrow').length`);
  assert.ok(rows >= 3, `one flat list of yours (${rows} rows)`);
  // Layout round 2 (compose.css, 20 Nov 2026): every room's frame starts at one left edge and takes the room, so
  // the Projects column is no longer 980 px. The project page still reads in the Projects column: the same width
  // rule and the same left edge as Projects home (updated 23 Nov 2026).
  const frame = (sel) => `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; return { max: getComputedStyle(el).maxWidth, left: Math.round(el.getBoundingClientRect().left) }; })()`;
  const page = await h.browser.ev(frame('.pj-page .vpage'));
  await clickWords(h, 'Projects', '.side');
  await waitFor(h, `!document.querySelector('.pj-page') && !![...document.querySelectorAll('main h1')].some((e) => e.innerText.includes('Projects'))`);
  await sleep(800);
  const home = await h.browser.ev(frame('main .vpage'));
  assert.ok(page && home, 'both pages stand in a frame');
  assert.equal(page.max, home.max, `project page column is ${page.max}, want the Projects column (${home.max})`);
  assert.ok(Math.abs(page.left - home.left) <= 1, `project page starts at the Projects column's edge (${page.left} vs ${home.left})`);
}, { timeout: 120000 });

test('Tasks page: who and when share one x on every row', async () => {
  const h = await harness();
  // 5 Nov 2026, the quiet rail: Tasks is a rail row now, not a More row.
  await clickWords(h, 'Tasks', '.side');
  await waitFor(h, `!![...document.querySelectorAll('h1')].some((e) => e.innerText.includes('Tasks'))`);
  await sleep(1000);
  await assertColumns(h, 'main', 6);
}, { timeout: 120000 });

// Today (23 Nov 2026, the design-language pass): on a wide frame the rest of the work is Balance's tail, one block
// under both columns (and, once the band is wide enough, two balanced CSS columns of rows inside it), so Next's rows
// in the work column and the tail's rows stand in boxes of different widths by design. One x per list still holds:
// every row standing in the same box (same left and right edge, i.e. the same column of the page) puts who and when
// at one x, and the tail is one such box (or two, in its two columns), never a scatter row by row.
test('Today: who and when share one x on every row', async () => {
  const h = await harness();
  await clickWords(h, 'Today', '.side');
  await waitFor(h, `!!document.querySelector('.td-view')`);
  await sleep(1000);
  const rows = await h.browser.ev(`[...document.querySelectorAll('.td-view .tkrow')].filter((r) => r.getBoundingClientRect().width > 2).map((r) => {
    const b = r.getBoundingClientRect();
    const x = (sel) => { const el = r.querySelector(sel); const e = el && el.getBoundingClientRect(); return e && e.width > 2 ? Math.round(e.x) : null; };
    return { box: Math.round(b.x) + '..' + Math.round(b.right), who: x('.tkrow-who'), when: x('.tkrow-when') };
  })`);
  assert.ok(rows.filter((r) => r.who != null).length >= 4, `.td-view: ${rows.length} rows with who, want 4`);
  assert.ok(rows.filter((r) => r.when != null).length >= 4, `.td-view: ${rows.length} rows with when, want 4`);
  const boxes = new Map();
  for (const r of rows) boxes.set(r.box, [...(boxes.get(r.box) ?? []), r]);
  // The work column, the day column and the tail (two inside it at most): never a box per row.
  assert.ok(boxes.size <= 4, `.td-view: rows stand in ${boxes.size} different boxes (${[...boxes.keys()].join(', ')})`);
  for (const [box, list] of boxes) {
    for (const k of ['who', 'when']) {
      const xs = list.map((r) => r[k]).filter((v) => v != null);
      if (xs.length) assert.ok(Math.max(...xs) - Math.min(...xs) <= 1, `.td-view rows at ${box}: ${k} scatters ${Math.min(...xs)}..${Math.max(...xs)}`);
    }
  }
}, { timeout: 120000 });

test('meeting actions: who and when share one x on every row', async () => {
  const h = await harness();
  await openProject(h);
  // t255: the sticky line became the tab bar.
  await clickWords(h, 'Notes', '.pt-bar[role="tablist"]');
  await sleep(800);
  await expandFolds(h, 'notes');
  // The harness serves no meetings:context channel (the panel stays null without it), so the context the
  // panel needs is built here from the same vault files with the real project parser, and answered at the
  // page's RPC layer before the note opens (window.nv is a proxy: a plain assignment would not stick). The
  // panel's reading and rows (what is asserted) run entirely in-page.
  const projRel = 'Projects/Brisbane Depot Refit/Brisbane Depot Refit.md';
  const noteText = readFileSync(path.join(h.vaultDir, 'Meetings/Friday walk.md'), 'utf8');
  const date = /^date:\s*(\S+)/m.exec(noteText)?.[1] ?? new Date().toISOString().slice(0, 10);
  assert.match(noteText, new RegExp(`project:\\s*${projRel.replace(/[./]/g, (c) => `\\${c}`)}`), 'the note names its project');
  const proj = PF.parseProject(readFileSync(path.join(h.vaultDir, projRel), 'utf8'), projRel);
  const context = { meeting: true, date, people: CARE_PEOPLE, me: proj.owner, projects: [{ path: projRel, name: proj.name, next: proj.next.map((n) => n.what), why: 'property' }], all: [{ path: projRel, name: proj.name }] };
  await h.browser.ev(`(() => {
    if (window.__careMeetings) return;
    window.__careMeetings = true;
    const context = JSON.parse(${JSON.stringify(JSON.stringify(context))});
    const orig = window.fetch.bind(window);
    window.fetch = (url, opts) => {
      try {
        if (url === '/rpc' && opts && JSON.parse(String(opts.body)).channel === 'meetings:context') {
          return Promise.resolve(new Response(JSON.stringify({ ok: true, result: context }), { headers: { 'content-type': 'application/json' } }));
        }
      } catch {}
      return orig(url, opts);
    };
  })()`);
  await clickWords(h, 'Friday walk', '[data-section="notes"]');
  await waitFor(h, `!!document.querySelector('.mt-panel')`);
  await sleep(800);
  await assertColumns(h, '.mt-panel', 2);
}, { timeout: 120000 });
