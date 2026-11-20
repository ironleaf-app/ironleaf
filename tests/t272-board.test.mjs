// node --test tests/t272-board.test.mjs — boards use the width (t272, 13 Nov 2026, on 10.2.7 at
// 3456x1408, with a picture of a Meetings room). Their "Open actions by project" board showed three
// fixed ~210px columns with the right two-thirds empty, tall thin cards wrapping to 5-6 lines, the
// first column's last card cut half drawn, and an empty project taking a whole column. The fix is
// in the shared records board (views/workspace/RecordLayouts.tsx, project-workspace.css), so every
// records view gets it at once:
// - columns share the row (flex 1 1 260px): few widen to fill, many keep 260px and the
//   board scrolls sideways with the tab bar's own edge fade, never a squeeze;
// - cards tile across a wide column (256px tracks: one card reads 260-519px, two or more
//   share wider columns side by side), so leftover width is more cards across, never
//   empty space or a stretched card;
// - the board grows to its cards and the page scrolls (every host page already scrolls),
//   so no card is ever cut; an empty column stays a slim quiet drop target.
// The same walk checks the view switch's other layouts at 3456x1408: the timeline spreads
// a narrow span to fill its scroller (the zoom's pace is the minimum, days keep honest
// gaps), and the donut sits centred instead of stranding the right side empty. Table,
// List, Gallery and Calendar already fill, so the walk proves they still do. Each live
// check fails without its rule: emptyRight read 870 at 3456, cards clipped at 1219, the
// timeline canvas read 370 in a 2300 box, the donut stranded 1700px. Made-up data only.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import { startHarness } from './vault-controls-harness.mjs';

const root = path.join(import.meta.dirname, '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Static: the shared mechanisms ────────────────────────────────────────────

test('board columns share the row and never cap their height', () => {
  const css = read('src/renderer/src/styles/project-workspace.css');
  const col = css.slice(css.indexOf('.ws-col {'), css.indexOf('.ws-col {') + 600);
  assert.ok(col.includes('flex: 1 1 260px'), 'few columns widen to fill the board');
  assert.ok(col.includes('min-width: 260px'), 'many columns keep 260px, never a squeeze');
  assert.ok(!css.includes('flex: 0 0 276px'), 'the fixed 276px column is gone');
  assert.ok(!css.includes('70vh'), 'no capped column height remains in the workspace');
  const start = css.indexOf('.ws-col-cards {');
  const cards = css.slice(start, css.indexOf('}', start));
  assert.ok(!cards.includes('overflow'), 'columns never scroll inside: the board grows, the page scrolls');
});

test('cards tile across a wide column, the more button and empty target span', () => {
  const css = read('src/renderer/src/styles/project-workspace.css');
  assert.ok(css.includes('repeat(auto-fill, minmax(min(256px, 100%), 1fr))'), 'leftover width is more cards across, each 260-519px');
  assert.ok(css.includes('.ws-col-cards > .ws-more'), 'the more button spans the tiled cards');
  assert.ok(css.includes('.ws-col-cards > .ws-col-empty'), 'the empty target spans the tiled cards');
});

test('an empty column reads slim and quiet, and stays a drop target', () => {
  const css = read('src/renderer/src/styles/project-workspace.css');
  const at = css.indexOf('.ws-col.is-empty {');
  assert.ok(at > 0, 'the slim empty column has its style');
  assert.ok(css.slice(at, at + 200).includes('flex: 0 0 150px'), 'slim: 150px, out of the sharing');
  assert.ok(css.includes('.ws-col.is-empty .ws-col-empty'), 'its tray reads quiet');
  assert.ok(read('src/renderer/src/views/workspace/RecordLayouts.tsx').includes("empty && !folded ? ' is-empty' : ''"), 'a column with no rows takes the slim style');
});

test('many columns scroll sideways with the tab bar’s own edge fade', () => {
  const css = read('src/renderer/src/styles/project-workspace.css');
  for (const side of ['right', 'left', 'both', 'none']) assert.ok(css.includes(`.ws-board[data-fade="${side}"]`), `the board fades at ${side}`);
  assert.ok(css.includes('calc(100% - 28px)'), 'the same 28px fade the tab bar uses');
  const tsx = read('src/renderer/src/views/workspace/RecordLayouts.tsx');
  assert.ok(tsx.includes('data-fade={fade}'), 'the board carries its fade');
  assert.ok(tsx.includes('el.scrollWidth - el.clientWidth'), 'the fade follows the scroll like the tabs’');
});

test('the timeline spreads a narrow span to fill, the donut sits centred', () => {
  const tsx = read('src/renderer/src/views/workspace/RecordTime.tsx');
  assert.ok(tsx.includes('Math.max(PPD[zoom], fit / span)'), 'the zoom’s pace is the minimum, a narrow span spreads');
  assert.ok(tsx.includes('new ResizeObserver(update)'), 'the spread follows the width');
  assert.ok(/\.ws-donut \{[^}]*justify-content: center/s.test(read('src/renderer/src/styles/project-workspace.css')), 'the donut sits centred, stranding neither side');
});

test('gallery tiles fill their grid instead of stranding empty tracks', () => {
  const css = read('src/renderer/src/styles/project-workspace.css');
  const start = css.indexOf('.ws-gallery {');
  const gal = css.slice(start, css.indexOf('}', start));
  assert.ok(gal.includes('repeat(auto-fit, minmax(232px, 560px))'), 'empty tracks fold away, tiles share up to 560px');
  assert.ok(gal.includes('justify-content: center'), 'a short row sits centred');
});

test('no :has(), no new !important in the shared board styles', () => {
  const css = read('src/renderer/src/styles/project-workspace.css');
  assert.deepEqual(css.match(/:has\(/g) ?? [], [':has('], 'the one pre-existing :has stands, none added');
  assert.equal((css.match(/!important/g) ?? []).length, 4, 'the four pre-existing !important stand, none added');
});

// ── Live: one boot, the board at three sizes ─────────────────────────────────

const PROJECTS = ['Harbourline Cart Fix', 'Museum Late Shift', 'ShadeCo Awning Install', 'Paper Bag Reorder', 'Night Roster Fill', 'Receipts Version Two', 'Front Counter Paint', 'Delivery Van Service', 'Winter Menu Print', 'Staff Training Nights', 'Back Room Shelves', 'Garden Bed Mulch'];
const OWNERS = ['Alex Chen', 'Priya Nair', 'Sam Ortega', 'Jess Wu'];
const SIZES = [[3456, 1408], [1920, 1117], [1219, 709]];

function writeBoardVault(dir, n, per, empties = 1) {
  // Done projects from an earlier walk go first, so one or two slim targets stand exactly.
  rmSync(path.join(dir, 'Projects', 'Empty Project'), { recursive: true, force: true });
  rmSync(path.join(dir, 'Projects', 'Quiet Project'), { recursive: true, force: true });
  rmSync(path.join(dir, 'Meetings'), { recursive: true, force: true });
  const w = (rel, text) => {
    const p = path.join(dir, ...rel.split('/'));
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, text);
  };
  PROJECTS.slice(0, n).forEach((name, pi) => {
    // Additive: the harness projects keep their own body (the drag walk needs Harbourline whole).
    if (!existsSync(path.join(dir, 'Projects', name, `${name}.md`))) w(`Projects/${name}/${name}.md`, `---\ntype: project\nstatus: active\nhealth: on track\nowner: ${OWNERS[pi % OWNERS.length]}\ndue: 2026-12-20\n---\n# ${name}\n\n## Summary\n\nMade-up project for the board width walk.\n`);
    const lines = [];
    // Eight verbs over five endings (coprime: all forty wordings differ, so none dedups).
    const verbs = ['Chase', 'Confirm', 'Price', 'Book', 'Write up', 'File', 'Count', 'Check'];
    const ends = ['the retry cover for the Friday rush', 'the roster gap for the late opening', 'the fitted price for the December crew', 'the delivery slot for the night team', 'the refund wording for the front counter'];
    for (let i = 0; i < per; i++) {
      const k = pi * per + i;
      lines.push(`- [ ] ${verbs[k % 8]} ${ends[k % 5]} — ${OWNERS[(pi + i) % OWNERS.length]} — due 2026-${k % 3 ? '11' : '12'}-${10 + (k % 18)}`);
    }
    const day = String(3 + (pi % 20)).padStart(2, '0');
    w(`Meetings/2026-11-${day} ${name} standup.md`, `---\ntype: meeting\ndate: 2026-11-${day}\nattendees: [${OWNERS[pi % OWNERS.length]}, ${OWNERS[(pi + 1) % OWNERS.length]}]\nproject: Projects/${name}/${name}.md\n---\n# 2026-11-${day} ${name} standup\n\n## Agenda\n\n- The week ahead\n\n## Actions\n\n${lines.join('\n')}\n`);
  });
  // Done everywhere, so its column stands empty: the slim quiet drop target.
  w('Projects/Empty Project/Empty Project.md', `---\ntype: project\nstatus: active\nhealth: on track\nowner: Jess Wu\ndue: 2026-12-20\n---\n# Empty Project\n\n## Summary\n\nEvery action done, so its board column stands empty.\n`);
  w('Meetings/2026-11-02 Empty standup.md', `---\ntype: meeting\ndate: 2026-11-02\nattendees: [Jess Wu]\nproject: Projects/Empty Project/Empty Project.md\n---\n# 2026-11-02 Empty standup\n\n## Agenda\n\n- Wrap up\n\n## Actions\n\n- [x] File the final invoice — Jess Wu\n`);
  // A second done project stands a second slim target (t276 walks one or two).
  if (empties > 1) {
    w('Projects/Quiet Project/Quiet Project.md', `---\ntype: project\nstatus: active\nhealth: on track\nowner: Jess Wu\ndue: 2026-12-20\n---\n# Quiet Project\n\n## Summary\n\nEvery action done, so its board column stands empty.\n`);
    w('Meetings/2026-11-02 Quiet standup.md', `---\ntype: meeting\ndate: 2026-11-02\nattendees: [Jess Wu]\nproject: Projects/Quiet Project/Quiet Project.md\n---\n# 2026-11-02 Quiet standup\n\n## Agenda\n\n- Wrap up\n\n## Actions\n\n- [x] File the final invoice — Jess Wu\n`);
  }
}

let H = null;
async function harness() {
  if (!H) {
    H = await startHarness();
    await H.services.invoke('settings:update', [{ prefs: { modules: { meetings: { on: true } } } }]);
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
    await new Promise((r) => setTimeout(r, 500));
    return 'CLICKED';
  })()`);
}
async function waitFor(h, js, ms = 15000) {
  const t0 = Date.now();
  for (;;) {
    try { if (await h.browser.ev(js)) return true; } catch {}
    if (Date.now() - t0 > ms) return false;
    await sleep(250);
  }
}
/** Fresh vault, fresh page, Meetings › Every action, its board drawn. */
async function openBoard(h, n, per, empties = 1) {
  writeBoardVault(h.vaultDir, n, per, empties);
  await h.services.rescanAll();
  await h.browser.send('Page.navigate', { url: `${h.origin}/harness.html` });
  assert.ok(await waitFor(h, `!!document.querySelector('.app')`, 60000), 'the app boots');
  await sleep(2000);
  assert.equal(await clickWords(h, 'Meetings', 'aside'), 'CLICKED', 'Meetings opens');
  await sleep(1000);
  assert.equal(await clickWords(h, 'Every action', 'main'), 'CLICKED', 'Every action opens');
  assert.ok(await waitFor(h, `!!document.querySelector('.ws-board')`, 10000), 'the board draws');
  await sleep(600);
}
async function setSize(h, w, hh) {
  await h.browser.send('Emulation.setDeviceMetricsOverride', { width: w, height: hh, deviceScaleFactor: 1, mobile: false });
  await sleep(800);
}

const BOARD_JS = `(() => {
  const view = [...document.querySelectorAll('section.ws-view')].find((s) => (s.getAttribute('aria-label') || '').includes('Open actions'));
  if (!view) return { error: 'no Open actions view' };
  const board = view.querySelector('.ws-board');
  if (!board) return { error: 'no board drawn' };
  const b = board.getBoundingClientRect();
  const cs = getComputedStyle(board);
  const cols = [...board.querySelectorAll(':scope > section.ws-col')].map((c) => {
    const r = c.getBoundingClientRect();
    const tray = c.querySelector('.ws-col-cards').getBoundingClientRect();
    return {
      w: Math.round(r.width),
      empty: c.classList.contains('is-empty'),
      dropWords: (c.querySelector('.ws-col-empty')?.innerText ?? '').trim(),
      cards: [...c.querySelectorAll('.ws-card')].map((k) => {
        const kr = k.getBoundingClientRect();
        return { w: Math.round(kr.width), clipped: kr.top < tray.top - 1 || kr.bottom > tray.bottom + 1 };
      }),
    };
  });
  const last = board.querySelector(':scope > section.ws-col:last-child').getBoundingClientRect();
  return {
    boardW: Math.round(b.width),
    scrolls: board.scrollWidth > board.clientWidth + 2,
    scrollW: Math.round(board.scrollWidth),
    fade: board.getAttribute('data-fade'),
    emptyRight: Math.round(b.right - parseFloat(cs.paddingRight || '0') - last.right),
    cols,
  };
})()`;

async function checkBoard(h, n, w, hh) {
  await setSize(h, w, hh);
  const m = await h.browser.ev(BOARD_JS);
  assert.ok(!m.error, `${w}x${hh}: the board draws${m.error ? ` (${m.error})` : ''}`);
  const filled = m.cols.filter((c) => !c.empty);
  const slim = m.cols.filter((c) => c.empty);
  assert.equal(filled.length, n, `${w}x${hh}: ${n} filled columns draw (saw ${filled.length})`);
  // The board keeps emptied values as targets only while few columns draw (past eight, every column
  // holds cards); the slim target is proven on the smaller boards.
  assert.equal(slim.length, n < 8 ? 1 : 0, `${w}x${hh}: the done project keeps its empty column`);
  for (const c of filled) assert.ok(c.w >= 259, `${w}x${hh}: columns keep 260px (saw ${c.w})`);
  const cards = filled.flatMap((c) => c.cards);
  assert.ok(cards.length > 0, `${w}x${hh}: cards draw`);
  for (const k of cards) {
    assert.ok(k.w <= 525, `${w}x${hh}: no stretched card (saw ${k.w}px)`);
    assert.equal(k.clipped, false, `${w}x${hh}: no card is ever cut`);
  }
  if (slim.length) {
    assert.ok(slim[0].w <= 170 && slim[0].w < Math.min(...filled.map((c) => c.w)), `${w}x${hh}: the empty column reads slim (saw ${slim[0].w})`);
    assert.ok(slim[0].dropWords.length > 0, `${w}x${hh}: the slim column stays a drop target`);
  }
  if (!m.scrolls) {
    const widest = Math.max(...m.cols.map((c) => c.w));
    assert.ok(m.emptyRight <= widest, `${w}x${hh}: no empty area wider than one column beside the last (saw ${m.emptyRight} beside ${widest})`);
    assert.equal(m.fade, 'none', `${w}x${hh}: no fade when nothing hides`);
  } else {
    assert.ok(['right', 'both'].includes(m.fade), `${w}x${hh}: the fade marks the hidden columns (saw ${m.fade})`);
  }
  return m;
}

for (const n of [1, 3, 6, 12]) {
  test(`the board shares ${n === 1 ? 'one column' : `${n} columns`} at every size`, { timeout: 300000 }, async () => {
    const h = await harness();
    await openBoard(h, n, 5);
    for (const [w, hh] of SIZES) await checkBoard(h, n, w, hh);
  });
}

test('many columns keep 260px and the fade follows the scroll', { timeout: 300000 }, async () => {
  const h = await harness();
  await openBoard(h, 12, 2);
  await setSize(h, 1920, 1117);
  const m = await h.browser.ev(BOARD_JS);
  assert.ok(m.scrolls, 'twelve columns scroll at 1920');
  for (const c of m.cols.filter((c) => !c.empty)) assert.ok(c.w >= 259 && c.w <= 290, `never a squeeze, never stretched while scrolling (saw ${c.w})`);
  assert.equal(m.fade, 'right', 'at the left edge the fade marks the right');
  await h.browser.ev(`document.querySelector('.ws-board').scrollTo({ left: 99999 })`);
  await sleep(400);
  assert.equal(await h.browser.ev(`document.querySelector('.ws-board').getAttribute('data-fade')`), 'left', 'at the right edge the fade marks the left');
  await h.browser.ev(`(() => { const b = document.querySelector('.ws-board'); b.scrollTo({ left: (b.scrollWidth - b.clientWidth) / 2 }); })()`);
  await sleep(400);
  assert.equal(await h.browser.ev(`document.querySelector('.ws-board').getAttribute('data-fade')`), 'both', 'midway the fade marks both ends');
});

test('a column of forty cards draws whole with nothing cut', { timeout: 300000 }, async () => {
  const h = await harness();
  await openBoard(h, 1, 40);
  await setSize(h, 3456, 1408);
  const m = await h.browser.ev(BOARD_JS);
  assert.ok(!m.error, m.error ?? '');
  const cards = m.cols.filter((c) => !c.empty).flatMap((c) => c.cards);
  assert.equal(cards.length, 40, `all forty cards draw (saw ${cards.length})`);
  for (const k of cards) {
    assert.equal(k.clipped, false, 'no card is ever cut');
    assert.ok(k.w <= 525, `no stretched card (saw ${k.w}px)`);
  }
  assert.ok(await h.browser.ev(`[...document.querySelectorAll('.ws-board .ws-col-cards')].every((t) => t.scrollHeight <= t.clientHeight + 2)`), 'no column scrolls inside: the board grows to its cards');
  await setSize(h, 1219, 709);
  const scrollers = await h.browser.ev(`(() => { const out = []; let el = document.querySelector('.ws-board'); while (el) { if (el.scrollHeight > el.clientHeight + 100) out.push(el.tagName); el = el.parentElement; } return out; })()`);
  assert.ok(scrollers.length > 0, `past the viewport the page scrolls (saw ${JSON.stringify(scrollers)})`);
});

/** A command from the palette, picked like a person picks it. */
async function palette(h, text) {
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75 });
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75 });
  assert.ok(await waitFor(h, `!!document.querySelector('.picker input')`, 5000), 'the palette opens');
  await h.browser.send('Input.insertText', { text });
  await sleep(1000);
  const done = await h.browser.ev(`(() => {
    const row = [...document.querySelectorAll('.picker-row')].find((x) => (x.querySelector('.picker-label')?.innerText.trim() ?? '') === ${JSON.stringify(text)});
    if (!row) return 'NOTFOUND';
    row.click();
    return 'CLICKED';
  })()`);
  assert.equal(done, 'CLICKED', `${text} runs`);
  await sleep(500);
}

/** The project's workspace, on its Plan: six workstreams over two statuses draw a status board. */
async function openWorkstreamBoard(h) {
  const rel = 'Projects/Harbourline Cart Fix/Harbourline Cart Fix.md';
  const p = path.join(h.vaultDir, ...rel.split('/'));
  const before = readFileSync(p, 'utf8');
  if (!before.includes('| Ovens |')) {
    writeFileSync(p, before.replace('| Receipts | Priya Nair | ready to send | Send v2 (reviewer PASS) |', `| Receipts | Priya Nair | ready to send | Send v2 (reviewer PASS) |
| Ovens | Sam Ortega | in progress | Cover the Saturday gap |
| Labels | Jess Wu | ready to send | Print the shelf run |
| Doors | Alex Chen | in progress | Fix the front sensor |
| Signs | Priya Nair | in progress | Hang the December set |`));
  }
  await h.services.rescanAll();
  await h.browser.send('Page.navigate', { url: `${h.origin}/harness.html` });
  assert.ok(await waitFor(h, `!!document.querySelector('.app')`, 60000), 'the app boots');
  await sleep(2000);
  await palette(h, 'Harbourline Cart Fix');
  await sleep(1200);
  await palette(h, 'Open this folder as a notebook');
  assert.ok(await waitFor(h, `!!document.querySelector('.ws-root')`, 10000), 'the workspace opens');
  assert.ok(await waitFor(h, `[...document.querySelectorAll('.ws-outline .ws-sec')].some((e) => (e.innerText || '').includes('Plan'))`, 15000), 'the outline lists Plan');
  await sleep(400);
  const plan = await h.browser.ev(`(() => { const b = [...document.querySelectorAll('.ws-sec')].find((e) => (e.innerText || '').includes('Plan')); if (!b) return 'NOTFOUND'; b.click(); return 'CLICKED'; })()`);
  assert.equal(plan, 'CLICKED', 'Plan opens');
  assert.ok(await waitFor(h, `!!document.querySelector('.ws-board')`, 10000), 'the status board draws');
  await sleep(600);
  return p;
}

const WS_COLS_JS = `[...document.querySelectorAll('.ws-board > section.ws-col')].map((c) => c.getAttribute('aria-label') + ':' + c.querySelectorAll('.ws-card').length)`;

/** A card dragged across, like a person drags it: headless Chromium cannot start a trusted HTML5
 *  drag from synthetic mouse events, so the move runs the same handlers a person’s drag runs — a
 *  real dragstart on the card, a dragover on the target column, and the drop — through the live
 *  elements, never the state underneath. Returns the drop hint the column showed. */
async function dragCard(h, from, to) {
  const hint = await h.browser.ev(`(() => {
    const cols = [...document.querySelectorAll('.ws-board > section.ws-col')];
    const src = cols[${from}], dst = cols[${to}];
    const card = src.querySelector('.ws-card');
    const dt = new DataTransfer();
    dt.setData('application/x-nv-record', 'drag-probe');
    dt.setData('text/plain', card.querySelector('.ws-title-cell')?.innerText ?? 'card');
    card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
    if (!document.body.classList.contains('ws-dragging')) return 'NODRAG';
    dst.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    const hint = document.querySelector('.ws-drop-hint')?.textContent ?? '';
    dst.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    document.body.dispatchEvent(new DragEvent('dragend', { bubbles: true }));
    return hint;
  })()`);
  await sleep(1500);
  return hint;
}

test('drag and drop still moves a card between columns', { timeout: 300000 }, async () => {
  const h = await harness();
  const file = await openWorkstreamBoard(h);
  await setSize(h, 1920, 1117);
  const counts = (cols) => Object.fromEntries(cols.map((c) => c.split(':')).map(([k, v]) => [k, Number(v)]));
  assert.deepEqual(counts(await h.browser.ev(WS_COLS_JS))['In progress'], 4, 'four in progress before the move');
  assert.deepEqual(counts(await h.browser.ev(WS_COLS_JS))['Ready to send'], 2, 'two ready before the move');
  const slim0 = await h.browser.ev(`[...document.querySelectorAll('.ws-board > section.ws-col.is-empty')].length`);
  assert.ok(slim0 >= 1, 'emptied statuses stand as slim targets');
  const hint = await dragCard(h, 0, 1);
  assert.ok(/move to ready to send/i.test(hint), `the column says what the drop will do (saw ${JSON.stringify(hint)})`);
  let cols = counts(await h.browser.ev(WS_COLS_JS));
  assert.equal(cols['In progress'], 3, 'one leaves In progress');
  assert.equal(cols['Ready to send'], 3, 'one lands in Ready to send');
  // A slim empty column takes a drop too: the board keeps its targets.
  const slimIdx = await h.browser.ev(`[...document.querySelectorAll('.ws-board > section.ws-col')].findIndex((c) => c.classList.contains('is-empty'))`);
  assert.ok(slimIdx > 1, 'a slim empty target stands');
  const label = await h.browser.ev(`document.querySelectorAll('.ws-board > section.ws-col')[${slimIdx}].getAttribute('aria-label')`);
  const hint2 = await dragCard(h, 0, slimIdx);
  assert.ok(new RegExp(`move to ${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(hint2), `the slim column says what the drop will do (saw ${JSON.stringify(hint2)})`);
  cols = counts(await h.browser.ev(WS_COLS_JS));
  assert.equal(cols['In progress'], 2, 'one more leaves In progress');
  assert.equal(cols[label], 1, `one lands on the slim ${label} target`);
  const text = readFileSync(file, 'utf8');
  assert.equal((text.match(/\| in progress \|/g) ?? []).length, 2, 'the file keeps two in progress');
  // The drop writes the column's own words ('Ready to send'); the board reads both casings as one.
  assert.equal((text.match(/\| [Rr]eady to send \|/g) ?? []).length, 3, 'the file keeps three ready');
  assert.equal((text.match(new RegExp(`\\| ${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\|`, 'g')) ?? []).length, 1, `the file keeps one ${label.toLowerCase()}`);
  await openWorkstreamBoard(h);
  cols = counts(await h.browser.ev(WS_COLS_JS));
  assert.deepEqual([cols['In progress'], cols['Ready to send'], cols[label]], [2, 3, 1], `both moves stand after a fresh boot (saw ${JSON.stringify(cols)})`);
});

test('cards keep every fact they show: who, when, the meeting', { timeout: 300000 }, async () => {
  const h = await harness();
  await openBoard(h, 2, 3);
  await setSize(h, 1920, 1117);
  const words = await h.browser.ev(`document.querySelector('.ws-board .ws-card')?.innerText ?? ''`);
  assert.ok(/Alex Chen|Priya Nair|Sam Ortega|Jess Wu/.test(words), `who shows (${JSON.stringify(words.slice(0, 120))})`);
  assert.ok(/Nov|Dec/.test(words), `when shows (${JSON.stringify(words.slice(0, 120))})`);
  assert.ok(/standup/i.test(words), `the meeting shows (${JSON.stringify(words.slice(0, 120))})`);
});

// ── The rest of the view switch at the size ──────────────────────────────────

async function openLayout(h, words) {
  const viewJS = `[...document.querySelectorAll('section.ws-view')].find((s) => (s.getAttribute('aria-label') || '').includes('Open actions'))`;
  const done = await h.browser.ev(`(() => {
    const view = ${viewJS};
    const b = view?.querySelector('.ws-layouts button[aria-label=${JSON.stringify(words)}]');
    if (!b) return 'NOTFOUND';
    b.scrollIntoView({ block: 'nearest' });
    b.click();
    return 'CLICKED';
  })()`);
  assert.equal(done, 'CLICKED', `${words} opens`);
  await sleep(900);
}

test('every layout in the switch uses the width at 3456x1408', { timeout: 300000 }, async () => {
  const h = await harness();
  await openBoard(h, 3, 5);
  await setSize(h, 3456, 1408);
  const bodyJS = `[...document.querySelectorAll('section.ws-view')].find((s) => (s.getAttribute('aria-label') || '').includes('Open actions')).querySelector('.ws-view-body').getBoundingClientRect()`;
  await openLayout(h, 'Table');
  const table = await h.browser.ev(`(() => { const b = ${bodyJS}; const t = document.querySelector('section.ws-view .ws-table').getBoundingClientRect(); return { body: Math.round(b.width), table: Math.round(t.width) }; })()`);
  assert.ok(table.table >= table.body - 4, `the table fills its body (saw ${table.table} in ${table.body})`);
  await openLayout(h, 'List');
  const list = await h.browser.ev(`(() => { const b = ${bodyJS}; const r = document.querySelector('section.ws-view .ws-row').getBoundingClientRect(); return { body: Math.round(b.width), row: Math.round(r.width) }; })()`);
  assert.ok(list.row >= list.body - 4, `list rows fill the body (saw ${list.row} in ${list.body})`);
  await openLayout(h, 'Gallery');
  const gal = await h.browser.ev(`(() => {
    const b = ${bodyJS};
    const tiles = [...document.querySelectorAll('section.ws-view .ws-tile')].map((t) => t.getBoundingClientRect());
    const top = tiles[0].top;
    const row = tiles.filter((r) => Math.abs(r.top - top) <= 8);
    return { body: Math.round(b.right), last: Math.round(Math.max(...row.map((r) => r.right))), tile: Math.round(row[0].width), across: row.length };
  })()`);
  assert.ok(gal.across >= 4, `the gallery reflows across the width (saw ${gal.across} across)`);
  assert.ok(gal.body - gal.last <= gal.tile, `no empty area wider than a tile beside the last (saw ${gal.body - gal.last} beside ${gal.tile})`);
  await openLayout(h, 'Timeline');
  const tl = await h.browser.ev(`(() => { const s = document.querySelector('section.ws-view .ws-tl-scroll'); const c = document.querySelector('section.ws-view .ws-tl-canvas'); return { box: Math.round(s.clientWidth), canvas: Math.round(c.getBoundingClientRect().width) }; })()`);
  assert.ok(tl.canvas >= tl.box - 2, `the timeline fills its scroller (saw ${tl.canvas} in ${tl.box})`);
  await openLayout(h, 'Calendar');
  const cal = await h.browser.ev(`(() => { const b = ${bodyJS}; const g = document.querySelector('section.ws-view .ws-cal-grid').getBoundingClientRect(); return { body: Math.round(b.width), grid: Math.round(g.width) }; })()`);
  assert.ok(cal.grid >= cal.body - 32, `the month fills its body (saw ${cal.grid} in ${cal.body})`);
  await openLayout(h, 'Chart');
  const pickChart = async (words, sel) => {
    const done = await h.browser.ev(`(() => {
      const view = [...document.querySelectorAll('section.ws-view')].find((s) => (s.getAttribute('aria-label') || '').includes('Open actions'));
      const b = [...view.querySelectorAll('.ws-seg[aria-label="Chart"] button')].find((x) => x.textContent.trim() === ${JSON.stringify(words)});
      if (!b) return 'NOTFOUND';
      b.click();
      return 'CLICKED';
    })()`);
    assert.equal(done, 'CLICKED', `${words} opens`);
    assert.ok(await waitFor(h, `!!document.querySelector('section.ws-view ${sel}')`, 10000), `${words} draws`);
  };
  await pickChart('Bars', '.ws-bars');
  const bars = await h.browser.ev(`(() => { const b = ${bodyJS}; const t = document.querySelector('section.ws-view .ws-bar-track').getBoundingClientRect(); return { body: Math.round(b.width), track: Math.round(t.width) }; })()`);
  assert.ok(bars.track >= 400, `bars measure across the width (saw a ${bars.track}px track in ${bars.body})`);
  await pickChart('Ring', '.ws-donut');
  const ring = await h.browser.ev(`(() => {
    const view = [...document.querySelectorAll('section.ws-view')].find((s) => (s.getAttribute('aria-label') || '').includes('Open actions'));
    const body = view.querySelector('.ws-view-body').getBoundingClientRect();
    const svg = view.querySelector('.ws-donut svg').getBoundingClientRect();
    const legend = view.querySelector('.ws-legend').getBoundingClientRect();
    const left = Math.min(svg.left, legend.left), right = Math.max(svg.right, legend.right);
    return { gapL: Math.round(left - body.left), gapR: Math.round(body.right - right) };
  })()`);
  assert.ok(Math.abs(ring.gapL - ring.gapR) <= 120, `the ring sits centred (saw ${ring.gapL} left, ${ring.gapR} right)`);
  // Centred, neither side strands the void the left-aligned ring left (right gap read 1700).
  assert.ok(ring.gapR <= 950, `no large empty area beside the ring (saw ${ring.gapR})`);
  await pickChart('Line', '.ws-line');
  const line = await h.browser.ev(`(() => {
    const view = [...document.querySelectorAll('section.ws-view')].find((s) => (s.getAttribute('aria-label') || '').includes('Open actions'));
    const body = view.querySelector('.ws-view-body').getBoundingClientRect();
    return { body: Math.round(body.width), line: Math.round(view.querySelector('.ws-line').getBoundingClientRect().width) };
  })()`);
  assert.ok(line.line >= line.body - 40, `the line runs the width (saw ${line.line} in ${line.body})`);
  await openLayout(h, 'Board');
});

// ── t276: the slim empty column keeps its room and reads like the rest ──────
// t272's after picture (Meetings › Every action, Board, 1920x1117) showed one fault: the
// slim empty column past the board's edge, its tray cut mid-word ("Drop a card h") and its
// head centred and wrapped. The shared board now guarantees, at 1219x709, 1920x1117 and
// 3456x1408 with 1 to 6 full columns plus 1 or 2 empty ones: whenever the columns'
// minimums (260 a full column, 150 a slim one, 12 a gap) fit the board's inner width, no
// column passes its edge and the board never scrolls, otherwise it scrolls with the fade;
// the slim head reads left like the other heads with its name wrapping whole; the tray
// reads short ("Drop here") so its words never cut. Made-up data only.

test('t276: the slim head reads left like the other heads, its name wraps whole', () => {
  const css = read('src/renderer/src/styles/project-workspace.css');
  const at = css.indexOf('.ws-col-fold {');
  assert.ok(at > 0, 'the column head has its style');
  assert.ok(css.slice(at, at + 300).includes('text-align: left'), 'heads read left: a button centres wrapped words by default');
  const nameAt = css.indexOf('.ws-col.is-empty .ws-col-name {');
  assert.ok(nameAt > 0, 'the slim name keeps its style');
  const nameRule = css.slice(nameAt, css.indexOf('}', nameAt));
  assert.ok(nameRule.includes('white-space: normal'), 'the slim name wraps');
  assert.ok(!nameRule.includes('break-word') && !nameRule.includes('break-all') && !nameRule.includes('anywhere'), 'it wraps whole words, never mid-word');
});

test('t276: the slim tray reads short so its words never cut', () => {
  const tsx = read('src/renderer/src/views/workspace/RecordLayouts.tsx');
  assert.ok(tsx.includes('>Drop here<'), 'the tray reads short');
  assert.ok(!tsx.includes('Drop a card here'), 'the long tray words are gone');
});

const T276_JS = `(() => {
  const view = [...document.querySelectorAll('section.ws-view')].find((s) => (s.getAttribute('aria-label') || '').includes('Open actions'));
  if (!view) return { error: 'no Open actions view' };
  const board = view.querySelector('.ws-board');
  if (!board) return { error: 'no board drawn' };
  const b = board.getBoundingClientRect();
  const cs = getComputedStyle(board);
  const padL = parseFloat(cs.paddingLeft || '0'), padR = parseFloat(cs.paddingRight || '0');
  const innerRight = b.right - padR;
  const cols = [...board.querySelectorAll(':scope > section.ws-col')].map((c) => {
    const r = c.getBoundingClientRect();
    const fold = c.querySelector('.ws-col-fold');
    const name = c.querySelector('.ws-col-name');
    const tray = c.querySelector('.ws-col-cards');
    const empty = c.querySelector('.ws-col-empty');
    const tr = tray.getBoundingClientRect();
    return {
      label: c.getAttribute('aria-label'),
      empty: c.classList.contains('is-empty'),
      w: Math.round(r.width),
      pastInner: Math.round(r.right - innerRight),
      colOver: c.scrollWidth - c.clientWidth,
      foldLeft: fold && getComputedStyle(fold).textAlign === 'left',
      nameFits: name ? name.scrollWidth - name.clientWidth : 0,
      trayText: empty ? empty.innerText.trim() : null,
      trayFits: empty ? empty.scrollWidth - empty.clientWidth : 0,
      cardsCut: [...c.querySelectorAll('.ws-card')].filter((k) => {
        const kr = k.getBoundingClientRect();
        return k.scrollWidth > k.clientWidth + 2 || kr.top < tr.top - 1 || kr.bottom > tr.bottom + 1;
      }).length,
    };
  });
  return {
    innerW: board.clientWidth - padL - padR,
    scrolls: board.scrollWidth > board.clientWidth + 2,
    fade: board.getAttribute('data-fade'),
    cols,
  };
})()`;

async function checkSlimBoard(h, w, hh) {
  await setSize(h, w, hh);
  const m = await h.browser.ev(T276_JS);
  assert.ok(!m.error, `${w}x${hh}: the board draws${m.error ? ` (${m.error})` : ''}`);
  assert.ok(m.cols.filter((c) => !c.empty).length >= 1 && m.cols.filter((c) => c.empty).length >= 1, `${w}x${hh}: full and slim columns draw`);
  const full = m.cols.filter((c) => !c.empty);
  const slim = m.cols.filter((c) => c.empty);
  for (const c of full) assert.ok(c.w >= 259, `${w}x${hh}: full columns keep 260px (saw ${c.w})`);
  for (const c of slim) assert.ok(c.w <= 170 && c.w < Math.min(...full.map((f) => f.w)), `${w}x${hh}: the empty column reads slim (saw ${c.w})`);
  // The slim column always gets its room first: whenever the minimums (260 a full column,
  // 150 a slim one, 12 a gap) fit the board's inner width, every column fits and the board
  // never scrolls; otherwise it scrolls with the fade.
  const minNeed = full.length * 260 + slim.length * 150 + (m.cols.length - 1) * 12;
  if (minNeed <= m.innerW + 1) {
    for (const c of m.cols) assert.ok(c.pastInner <= 2, `${w}x${hh}: minimums fit, so ${c.label} stays inside the edge (saw ${c.pastInner}px past)`);
    assert.equal(m.scrolls, false, `${w}x${hh}: minimums fit, so the board never scrolls`);
    assert.equal(m.fade, 'none', `${w}x${hh}: no fade when nothing hides`);
  } else {
    assert.equal(m.scrolls, true, `${w}x${hh}: minimums need ${minNeed}px in ${Math.round(m.innerW)}, so the board scrolls`);
    assert.equal(m.fade, 'right', `${w}x${hh}: at the left edge the fade marks the right (saw ${m.fade})`);
  }
  for (const c of m.cols) {
    assert.ok(c.foldLeft, `${w}x${hh}: ${c.label} reads left like the other heads`);
    assert.ok(c.colOver <= 2, `${w}x${hh}: nothing inside ${c.label} spills past its side (saw ${c.colOver}px)`);
    assert.equal(c.cardsCut, 0, `${w}x${hh}: no card in ${c.label} is cut`);
  }
  for (const c of slim) {
    assert.ok(c.nameFits <= 2, `${w}x${hh}: the slim name wraps whole, never cut (saw ${c.nameFits}px past)`);
    assert.equal(c.trayText, 'Drop here', `${w}x${hh}: the slim tray reads short (saw ${JSON.stringify(c.trayText)})`);
    assert.ok(c.trayFits <= 2, `${w}x${hh}: the slim words never cut (saw ${c.trayFits}px past)`);
  }
}

for (let n = 1; n <= 6; n++) {
  for (let e = 1; e <= 2; e++) {
    test(`t276: ${n} full plus ${e === 1 ? '1 empty' : '2 empties'} at every size`, { timeout: 300000 }, async () => {
      const h = await harness();
      await openBoard(h, n, 5, e);
      for (const [w, hh] of SIZES) await checkSlimBoard(h, w, hh);
    });
  }
}
