// node --test tests/p25-one-column.test.mjs — p25 (5 Nov 2026): one column and one title place on every Vault page.
// A person clicking through Today, Inbox, Projects, Tasks, Meetings, Shared spaces, Notes, People, every pack page
// and Settings' own pages sees the column's left and right edges and the title's position stay put, at 3456x1408,
// 1920x1117 and 1219x709. The live walk below fails if any room's column edges or title baseline differ by more than
// 1 px from the others. Baseline is proven by identity, not estimated: same font, size, line-height, weight and
// title top means the same baseline, so the walk asserts those plus the title height. Named exceptions, each with
// its reason:
// - Home folded into Today (5 Nov 2026, one morning place): no rail row, old links open Today, so walking it
//   would measure Today twice; Today is already walked. Tasks joined the walk the same day (its own 980 px had
//   sat it narrower than every room with its title 12 px high).
// - Settings' titles are 20 px section titles beside a 220 px nav (a two-pane layout, not a room head), so their
//   baseline and words differ by design; their COLUMN edges still join the rooms.
// - Shared spaces' first body block is a centred empty state (no full-width body until a space exists); its column
//   box and title still join the rooms.
// - Publications needs one publication to show its titled page (an empty Publications is a start screen with no
//   title by design), so the walk seeds one made-up publication first.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import { openSettings, startHarness } from './vault-controls-harness.mjs';
import { cssPxFor } from './css-px.mjs';

const root = path.join(import.meta.dirname, '..');
const read = (p) => cssPxFor(p, readFileSync(path.join(root, p), 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Static: the mechanism the live walk proves ───────────────────────────────────────────────────────────────

// The one column lives in the frame: every wide room page stands in --page-max with the frame's side pad, and a
// page that truly runs full width (a board, a graph) says .full. No room carries its own width any more (was:
// Inbox 960, Projects/Shared spaces/the project page 980, Tasks' today 880 — each its own left edge).
test('the frame caps every room page at the one width', () => {
  const frame = read('src/renderer/src/styles/page-frame.css');
  assert.ok(/\.vscroll > \.vpage\.wide \{[^}]*max-width: var\(--page-max\)/s.test(frame), 'wide room pages stand in --page-max');
  assert.ok(/\.vscroll > \.vpage\.wide\.full \{[^}]*max-width: none/s.test(frame), 'a full-width page opts out with .full');
  for (const f of ['src/renderer/src/views/HomeView.tsx', 'src/renderer/src/views/SharedSpacesHome.tsx']) {
    assert.ok(read(f).includes('<div className="vpage wide">'), `${f} stands its page in the frame with no width of its own`);
  }
  // Inbox is a list with its detail beside it (layout round 3): .has-split, still no width of its own.
  assert.ok(read('src/renderer/src/views/InboxPage.tsx').includes('<div className="vpage wide has-split">'), 'Inbox stands its list and detail in the frame with no width of its own');
  const projects = read('src/renderer/src/views/ProjectsHome.tsx');
  // Layout round 3: the list reads with its detail beside it (.has-split); the gallery and board run full width.
  assert.ok(projects.includes("`vpage wide${view === 'list' ? ' has-split' : ' full'}`"), 'Projects stands its list in the frame and runs the rest full width');
  assert.ok(!projects.includes('vpage wide" style={{ maxWidth'), 'Projects carries no width of its own');
  const tasks = read('src/renderer/src/views/TasksView.tsx');
  assert.ok(tasks.includes('<div className="vpage wide">'), 'Tasks stands its one view in the frame (t249: the board is gone)');
  assert.ok(!tasks.includes("' full'"), 'no full-width opt-out left on one view');
  assert.ok(!tasks.includes('vpage wide" style={{'), 'Tasks carries no width or pads of its own (its own 980 px sat it narrower with its title 12 px high)');
});

// The icon sits INSIDE the column at its left edge; the lead, the facts and the body start at the column edge on
// every room (was: pack pages indented lead, facts and body 50 px, off the title's words, so Money's body started
// 1222 while Notes' started 1174).
test('pack bodies start at the column edge, not off the title', () => {
  for (const f of ['src/renderer/src/styles/packs-87.css', 'src/renderer/src/styles/w3b-packs.css']) {
    assert.ok(!read(f).includes('margin-left: 50px'), `${f} indents no body off the title`);
  }
});

// Today keeps its date line above its greeting; the greeting's baseline joins the other rooms because the date's
// block is exactly 20 px and the head's pad is the frame's pad minus those 20 px (was: 36 px of pad plus the date,
// so the greeting sat lowest of every room).
test("today's greeting joins the other titles under its date line", () => {
  const frame = read('src/renderer/src/styles/page-frame.css');
  assert.ok(/\.nv-today-head \{[^}]*padding-top: calc\(var\(--page-pad-top\) - 20px\)/s.test(frame), 'the head gives back exactly the date block');
  assert.ok(/\.td-head-top \.td-date \{[^}]*line-height: 20px/s.test(frame), 'the date block is exactly 20 px');
});

// Notes rows: the date ends at the row's divider and Tick all (was: about 24 px short, behind the pin's place).
test('notes rows end their dates at the divider', () => {
  const src = read('src/renderer/src/views/NotesPage.tsx');
  const wrap = src.slice(src.indexOf('w2b-rowwrap${'));
  assert.ok(wrap.indexOf('w2b-pin') < wrap.indexOf('w2b-when'), 'the date is the last thing in the row, past the pin');
  assert.ok(/\.w2b-tickall \.btn \{[^}]*padding-right: 0/s.test(read('src/renderer/src/styles/w2b.css')), 'Tick all ends its words at the same edge');
});

// People ends with no help sentence (p25: the ⋯ beside the primary action speaks for itself — every other room
// keeps its foot quiet, and the menu already names both actions whole).
test('people keeps no help sentence under its list', () => {
  assert.ok(!read('src/renderer/src/views/PeoplePage.tsx').includes('sit under'), 'the help sentence is gone');
});

// ── Live: one boot, the packs on, every room walked at three windows ─────────────────────────────────────────

let H = null;
async function harness() {
  if (!H) {
    H = await startHarness();
    // Every pack on (meetings too: its sidebar row needs it), then a boot so the shell picks it up.
    await H.services.invoke('settings:update', [{ prefs: { modules: Object.fromEntries(['finance', 'documents', 'business', 'systems', 'publications', 'goals', 'family', 'health', 'house', 'vehicles', 'career', 'travel', 'meetings'].map((id) => [id, { on: true }])) } }]);
    // One made-up publication, so Publications shows its titled page rather than its start screen.
    await H.services.vault.createText('Publications/Harbour Gazette/Harbour Gazette.md', `---\ntype: publication\n---\n# Harbour Gazette\n\n## Sections\n\n| Section | Pages | Sources | Rules |\n|---|---|---|---|\n| News | 2 | | |\n`).catch(() => {});
    await H.services.rescan('Publications/Harbour Gazette/Harbour Gazette.md');
    await H.services.rescanAll();
    await H.browser.send('Page.navigate', { url: `${H.origin}/harness.html` });
    for (let i = 0; i < 90; i++) {
      await sleep(500);
      try {
        if (await H.browser.ev(`!!document.querySelector('.app')`)) break;
      } catch {}
    }
    await sleep(2000);
  }
  return H;
}
after(async () => {
  await H?.close().catch(() => {});
  H = null;
});

const SEL = 'button, a[href], select, input, textarea, [role="button"], [role="tab"], [role="menuitem"], summary';
async function clickWords(h, words, scope = '') {
  return h.browser.ev(`(async () => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
    const root = ${scope ? `document.querySelector(${JSON.stringify(scope)})` : 'document'};
    if (!root) return 'NOROOT';
    const els = [...root.querySelectorAll(${JSON.stringify(SEL)})].filter(vis);
    const el = els.find((e) => ((e.innerText || e.getAttribute('aria-label') || e.title || '').replace(/\\s+/g, ' ').includes(${JSON.stringify(words)})));
    if (!el) return 'NOTFOUND';
    el.scrollIntoView({ block: 'nearest' });
    el.click();
    await new Promise((r) => setTimeout(r, 400));
    return 'CLICKED';
  })()`);
}
// Open a room the way a person does: its sidebar row, else Ctrl+K (t10 the quiet More, 8 Nov 2026: packs
// and places left More for the palette, each by its own name; narrow windows still fold rows away).
async function openRoom(h, name) {
  // Settings lives in the account menu (the chip at the sidebar's foot), not as a sidebar row.
  if (name === 'Settings' && (await openSettings(h)) === 'CLICKED') return;
  if ((await clickWords(h, name, '.sidebar.left, aside')) === 'CLICKED') return;
  const label = name === 'Shared spaces' ? 'Open Shared spaces' : name;
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75 });
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75 });
  if (!(await waitFor(h, `!!document.querySelector('.picker input')`, 4000))) {
    if ((await clickWords(h, 'Ask or find anything', '.topbar')) !== 'CLICKED') assert.fail(`could not open ${name}: no palette`);
    if (!(await waitFor(h, `!!document.querySelector('.picker input')`))) assert.fail(`could not open ${name}: no palette`);
  }
  await h.browser.send('Input.insertText', { text: name });
  await sleep(700);
  const picked = await h.browser.ev(`(() => {
    const rows = [...document.querySelectorAll('.picker-row')];
    const text = (r, sel) => r.querySelector(sel)?.innerText.trim() ?? '';
    // The pack's own row (a note kind may share its name: 'Goals' the kind sorts first).
    const row = rows.find((r) => text(r, '.picker-label') === ${JSON.stringify(label)} && text(r, '.picker-detail') === 'Pack')
      ?? rows.find((r) => text(r, '.picker-label') === ${JSON.stringify(label)});
    if (!row) return 'NOTFOUND';
    row.click();
    return 'CLICKED';
  })()`);
  if (picked !== 'CLICKED') assert.fail(`could not open ${name} from the palette`);
  await sleep(600);
}
async function waitFor(h, js, ms = 12000) {
  const t0 = Date.now();
  for (;;) {
    try {
      if (await h.browser.ev(js)) return true;
    } catch {}
    if (Date.now() - t0 > ms) return false;
    await sleep(250);
  }
}

const ROOMS = ['Today', 'Inbox', 'Projects', 'Tasks', 'Meetings', 'Shared spaces', 'Notes', 'People', 'Money', 'Papers', 'Business', 'Systems', 'Publications', 'Goals', 'Family', 'Health', 'House', 'Cars', 'Career', 'Trips'];
const SETTINGS = ['General', 'Packs', 'Backups'];

const MEASURE_JS = `(() => {
  document.querySelector('.nv-page-scroll,.vscroll,.td-view,.settings-scroll')?.scrollTo?.(0, 0);
  const main = document.querySelector('main');
  const h1 = main?.querySelector('h1');
  if (!h1) return { error: 'no h1 in ' + (main?.innerText ?? '').replace(/\\s+/g, ' ').slice(0, 60) };
  const hr = h1.getBoundingClientRect();
  const box = h1.closest('.nv-page,.vpage,.td-inner,.settings-page')
    || main.querySelector('.nv-page,.vpage,.td-inner,.settings-page');
  if (!box) return { error: 'no page box' };
  const br = box.getBoundingClientRect();
  const hs = getComputedStyle(h1);
  const head = h1.closest('header,.w2a-head') || h1;
  let sib = head.nextElementSibling;
  while (sib && sib.getBoundingClientRect().height < 2) sib = sib.nextElementSibling;
  const sr = sib ? sib.getBoundingClientRect() : null;
  return {
    title: (h1.innerText || '').replace(/\\s+/g, ' ').slice(0, 40),
    boxL: br.left, boxR: br.right, titleTop: hr.top, titleH: hr.height,
    bodyL: sr?.left ?? null, bodyR: sr?.right ?? null,
    isVsub: sib?.classList?.contains('vsub') ?? false,
    panes: box.hasAttribute('data-has-panes'),
    font: [hs.fontSize, hs.lineHeight, hs.fontWeight, hs.fontFamily].join(' '),
  };
})()`;

async function walk(h, rooms, size) {
  const [w, hh] = size;
  await h.browser.send('Emulation.setDeviceMetricsOverride', { width: w, height: hh, deviceScaleFactor: 1, mobile: false });
  await sleep(500);
  const rows = [];
  for (const room of rooms) {
    await openRoom(h, room);
    let m = null;
    for (let i = 0; i < 30; i++) {
      await sleep(400);
      m = await h.browser.ev(MEASURE_JS).catch(() => null);
      if (m && !m.error) break;
    }
    assert.ok(m && !m.error, `${room} shows its titled page at ${w}x${hh}${m?.error ? `: ${m.error}` : ''}`);
    rows.push({ room, ...m });
  }
  return rows;
}

function spread(rows, key) {
  const vs = rows.map((r) => r[key]);
  return Math.max(...vs) - Math.min(...vs);
}
function check(rows, size) {
  const tag = `at ${size[0]}x${size[1]}`;
  // t254 (13 Nov 2026): Today stands in the rooms' one column again — its own 2000 cap left 582 dead pixels
  // each side at 3456 wide, so their words replace the t1/t242 exception and every room below shares the
  // one column check.
  const columned = rows;
  const titled = rows.filter((r) => !r.room.startsWith('Settings/'));
  const bodied = rows.filter((r) => !r.room.startsWith('Settings/') && r.room !== 'Shared spaces');
  assert.ok(spread(columned, 'boxL') <= 1, `column left edges stay put ${tag} (spread ${spread(columned, 'boxL').toFixed(1)}: ${columned.map((r) => `${r.room}=${r.boxL.toFixed(1)}`).join(', ')})`);
  assert.ok(spread(columned, 'boxR') <= 1, `column right edges stay put ${tag} (spread ${spread(columned, 'boxR').toFixed(1)})`);
  // App panes (panes.css, 20 Nov 2026): a list-and-detail room fills the window as panes under a compact head, its
  // frame pad --space-5 (24) instead of --space-6 (36), so its title sits 12 px higher on purpose. The one title
  // place is now one place per head shape: every pane room shares one top, every other room shares one top, and
  // the two stand exactly that 12 px apart (23 Nov 2026).
  const tops = (rs) => `spread ${spread(rs, 'titleTop').toFixed(1)}: ${rs.map((r) => `${r.room}=${r.titleTop.toFixed(1)}`).join(', ')}`;
  const paned = titled.filter((r) => r.panes);
  const framed = titled.filter((r) => !r.panes);
  assert.ok(framed.length > 0, `some rooms keep the frame's own head ${tag}`);
  assert.ok(spread(framed, 'titleTop') <= 1, `title tops stay put ${tag} (${tops(framed)})`);
  if (paned.length) {
    assert.ok(spread(paned, 'titleTop') <= 1, `pane rooms' title tops stay put among themselves ${tag} (${tops(paned)})`);
    const gap = framed[0].titleTop - paned[0].titleTop;
    assert.ok(Math.abs(gap - 12) <= 1, `a pane room's compact head lifts its title exactly 12 px ${tag} (saw ${gap.toFixed(1)}: ${tops(titled)})`);
  }
  assert.ok(spread(titled, 'titleH') <= 1, `title heights stay put ${tag} (spread ${spread(titled, 'titleH').toFixed(1)})`);
  const fonts = new Set(titled.map((r) => r.font));
  assert.equal(fonts.size, 1, `room titles share one font ${tag} (${[...fonts].join(' vs ')})`);
  assert.ok(spread(bodied, 'bodyL') <= 1, `first bodies start at one edge ${tag} (spread ${spread(bodied, 'bodyL').toFixed(1)}: ${bodied.map((r) => `${r.room}=${(r.bodyL ?? -1).toFixed(1)}`).join(', ')})`);
  // At 3456 wide, 5 Nov 2026: past 1700px a first body that is prose (.vsub, Family's and House's Fills itself
  // line) keeps the prose cap (76ch) instead of spanning the widened column, as the former host app's prose
  // does — 170-character lines are why. Such bodies still start at the edge and share one capped end among
  // themselves; every other first body ends at the column edge as before, and below 1700px the old contract
  // stands whole.
  // 23 Nov 2026 (design language, packs: one reading order): the pack's "Fills itself" line became the lead's quiet
  // follow-on at 14 px, held to 80ch at every width (w3b-packs.css .w3b-page > p.vsub), not only past 1700px. So a
  // prose first body is capped at every size: it still starts at the column edge, the capped lines share one end
  // among themselves, and none runs past the column; past 1700px the cap still stops well short of the edge.
  const capped = true;
  const full = bodied.filter((r) => !(capped && r.isVsub));
  const prose = bodied.filter((r) => capped && r.isVsub);
  assert.ok(spread(full, 'bodyR') <= 1, `first bodies end at one edge ${tag} (spread ${spread(full, 'bodyR').toFixed(1)})`);
  if (prose.length > 1) assert.ok(spread(prose, 'bodyR') <= 1, `capped prose ends at one edge ${tag} (spread ${spread(prose, 'bodyR').toFixed(1)})`);
  for (const r of prose) assert.ok(r.bodyR <= r.boxR + 1, `${r.room}'s prose never runs past the column edge ${tag}`);
  if (size[0] >= 1700) for (const r of prose) assert.ok(r.bodyR < r.boxR - 100, `${r.room}'s prose holds at its cap, short of the column edge ${tag}`);
  const settings = rows.filter((r) => r.room.startsWith('Settings/'));
  assert.ok(spread(settings, 'titleTop') <= 1, `Settings titles stay put among themselves ${tag}`);
}

test('every room shares one column and one title place at 3456x1408', { timeout: 600000 }, async () => {
  const h = await harness();
  const rows = await walk(h, ROOMS, [3456, 1408]);
  await openRoom(h, 'Settings');
  for (const sec of SETTINGS) {
    await clickWords(h, sec, 'main');
    await sleep(900);
    const m = await h.browser.ev(MEASURE_JS);
    assert.ok(!m.error, `Settings/${sec} shows its page: ${m.error ?? ''}`);
    rows.push({ room: `Settings/${sec}`, ...m });
  }
  check(rows, [3456, 1408]);
});

test('every room shares one column and one title place at 1219x709', { timeout: 600000 }, async () => {
  const h = await harness();
  const rows = await walk(h, ROOMS, [1219, 709]);
  await openRoom(h, 'Settings');
  for (const sec of SETTINGS) {
    await clickWords(h, sec, 'main');
    await sleep(900);
    const m = await h.browser.ev(MEASURE_JS);
    assert.ok(!m.error, `Settings/${sec} shows its page: ${m.error ?? ''}`);
    rows.push({ room: `Settings/${sec}`, ...m });
  }
  check(rows, [1219, 709]);
});

test('the middle window agrees too (1920x1117, one room of each shape)', { timeout: 600000 }, async () => {
  // The frame holds no 1920-only rule; one room of each head shape proves the middle size follows the others.
  const h = await harness();
  const rows = await walk(h, ['Today', 'Tasks', 'Inbox', 'Projects', 'Notes', 'Money'], [1920, 1117]);
  check(rows, [1920, 1117]);
});

test("notes rows end their dates at the divider and Tick all", { timeout: 600000 }, async () => {
  const h = await harness();
  await h.browser.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1117, deviceScaleFactor: 1, mobile: false });
  await openRoom(h, 'Notes');
  await sleep(1200);
  const m = await h.browser.ev(`(() => {
    const row = document.querySelector('.w2b-rowwrap');
    if (!row) return { error: 'no rows' };
    const date = row.querySelector(':scope > .w2b-when')?.getBoundingClientRect();
    if (!date) return { error: 'no row-end date' };
    const tick = document.querySelector('.w2b-tickall .btn');
    const range = document.createRange();
    range.selectNodeContents(tick);
    const words = range.getClientRects();
    const textRight = words.length ? words[words.length - 1].right : null;
    return { dateRight: date.right, rowRight: row.getBoundingClientRect().right, tickRight: textRight };
  })()`);
  assert.ok(!m.error, m.error ?? '');
  assert.ok(Math.abs(m.dateRight - m.rowRight) <= 1, `the date ends at the divider (${m.dateRight} vs ${m.rowRight})`);
  assert.ok(Math.abs(m.tickRight - m.rowRight) <= 1, `Tick all ends at the divider (${m.tickRight} vs ${m.rowRight})`);
});
