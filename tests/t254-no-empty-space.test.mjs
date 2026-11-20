// node --test tests/t254-no-empty-space.test.mjs — no big empty space anywhere (t254, 13 Nov 2026, after
// looking at 10.2.6 on a own window). Their project pages showed Key dates at half width with an empty
// half beside it, People under it with nothing to its left, cards holding one short line across 1,700
// pixels, and lists ending with a white field below — on every page, not just the project page. Another
// job (t253) owns the project page; every other room is here. The fix is in the shared mechanisms, so
// every page gets it at once:
// - the rooms' one column (--page-max) reads 2400 past 2400px viewports (was 1440, leaving 862 dead pixels
//   each side at 3456 wide; Today stands in it again, its own 2000 cap gone);
// - pack sections (p87 and w3b), Inbox cards and a meeting's sections pair two across past 2400px, a lone
//   section taking the width and the odd count's first spanning, so a pair slot never stands empty;
// - gallery and photo grids reflow to the width instead of fixed columns;
// - a section holding only its quiet line reads bare, never a card with one short line in it.
// The live walk below measures every fixed room at 3456x1408 on a big made-up vault (t200's 3,000 notes
// plus more projects): no page gutter wider than 400px beside content, no empty pair slot, pairing really
// happening, and no card wider than about three times its longest line (3.5, giving stat tiles and paired
// cards room for their padding and actions). Notes keep their reading width and the search dialog its
// width by design, so the walk proves they stay put instead. Each check fails without its rule: gutters
// read 862/582, lone-line cards read 5-9x, fixed grids read 3-4 columns, stacked sections share no row.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import { openSettings, startHarness } from './vault-controls-harness.mjs';
import { writeT200Vault } from './t200-vault.mjs';

const root = path.join(import.meta.dirname, '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Static: the shared mechanisms ────────────────────────────────────────────

test('the rooms’ one column reads 2400 past 2400px, and Today stands in it', () => {
  const shell = read('src/renderer/src/styles/polish-shell.css');
  assert.ok(/:root\s*\{[^}]*--page-max:\s*1080px/s.test(shell), 'below 1700px the 1080 column stands');
  const ultra = shell.indexOf('@media (min-width: 1700px)');
  assert.ok(/--page-max:\s*1280px/.test(shell.slice(ultra)), 'past 1700px the 1280 ultra measure stands');
  const owner = shell.indexOf('@media (min-width: 2400px)', ultra);
  assert.ok(owner > ultra, 'the second step starts past 2400px viewports');
  assert.ok(/--page-max:\s*2400px/.test(shell.slice(owner)), 'past 2400px rooms share the 2400 measure');
  assert.ok(!/\.td-inner\s*\{\s*max-width:\s*2000px/.test(shell), 'Today keeps no width of its own');
  assert.ok(/\.td-else-groups\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 1fr\)/s.test(shell), 'Also’s groups still pair inside it');
  assert.ok(shell.includes('.td-else-groups > :first-child:nth-last-child(odd)'), 'the odd count’s first spans with no :has');
});

test('pack sections pair two across with the odd first spanning, never a :has', () => {
  for (const [file, body, item] of [
    ['src/renderer/src/styles/packs-87.css', '.p87-body', 'section.p87-sec'],
    ['src/renderer/src/styles/w3b-packs.css', '.w3b-page', 'section'],
  ]) {
    const css = read(file);
    const at = css.indexOf('@media (min-width: 2400px)');
    assert.ok(at > 0, `${file} pairs past 2400px viewports`);
    const wide = css.slice(at);
    assert.ok(new RegExp(`${body.replace(/\./g, '\\.')} \\{[^}]*display: grid;[^}]*grid-template-columns: minmax\\(0, 1fr\\) minmax\\(0, 1fr\\)`, 's').test(wide), `${body} pairs two across`);
    assert.ok(wide.includes('grid-auto-flow: dense'), `${body} fills behind a spanning box`);
    assert.ok(wide.includes(`${item}:first-of-type:nth-last-of-type(odd)`), 'the odd count’s first spans with no :has');
    assert.ok(!/:has\(/.test(wide) && !/!important/.test(wide), 'no :has(), no new !important');
  }
});

test('a section holding only its quiet line reads bare, never a card', () => {
  const shell = read('src/renderer/src/views/modules/pack87.tsx');
  assert.ok(shell.includes('pad, bare, children'), 'PackSection takes bare');
  assert.ok(shell.includes('<div className="p87-bare">{children}</div>'), 'bare skips the card box');
  assert.ok(read('src/renderer/src/styles/packs-87.css').includes('.p87-bare {'), 'the bare line has its style');
  for (const [file, words] of [
    ['src/renderer/src/views/modules/RecordModulePage.tsx', 'Bills due" bare'],
    ['src/renderer/src/views/modules/life/BusinessPage.tsx', 'bare={!m.openSupport.length}'],
    ['src/renderer/src/views/modules/life/SystemsPage.tsx', 'bare={!due.length}'],
    ['src/renderer/src/views/modules/personal/CareerPage.tsx', 'bare={!a.files.length}'],
  ]) {
    assert.ok(read(file).includes(words), `${file} bares its lone lines (${words})`);
  }
});

test('Inbox cards and a meeting’s sections pair, the folder rail widens', () => {
  const w2a = read('src/renderer/src/styles/w2a.css');
  const at = w2a.indexOf('@media (min-width: 2400px)');
  assert.ok(at > 0, 'Inbox pairs past 2400px viewports');
  assert.ok(w2a.slice(at).includes("div[aria-label='Waiting to be filed']"), 'the waiting list pairs its cards');
  assert.ok(w2a.slice(at).includes('div.card:first-of-type:nth-last-of-type(odd)'), 'the odd card spans with no :has');
  const w2b = read('src/renderer/src/styles/w2b.css');
  const mt = w2b.indexOf('@media (min-width: 2400px)');
  assert.ok(mt > 0, 'the meeting page pairs past 2400px viewports');
  assert.ok(w2b.slice(mt).includes('.nv-page .w2b-meeting'), 'scoped to the room page, as a1');
  assert.ok(w2b.slice(mt).includes('section:first-of-type:nth-last-of-type(odd)'), 'the odd section spans with no :has');
  assert.ok(/\.w2b-folders \{\s*width: 280px/.test(w2b.slice(mt)), 'the Notes rail widens for long names');
  assert.ok(!/:has\(/.test(w2a.slice(at)) && !/:has\(/.test(w2b.slice(mt)), 'no :has() in either');
  const page = read('src/renderer/src/views/modules/work/MeetingsPage.tsx');
  assert.ok(page.includes('<section className="card w2b-card w2b-norec"'), 'the no-recording card is a section, so it pairs');
});

test('gallery and photo grids reflow to the width', () => {
  const kit = read('src/renderer/src/styles/kit.css');
  const at = kit.indexOf('@media (min-width: 2400px)');
  assert.ok(at > 0, 'the kit reflows past 2400px viewports');
  assert.ok(/\.gal \{\s*grid-template-columns: repeat\(auto-fill, minmax\(300px, 1fr\)\)/s.test(kit.slice(at)), 'the gallery reflows instead of three fixed columns');
  const w3b = read('src/renderer/src/styles/w3b-packs.css');
  assert.ok(/\.w3b-photos \{\s*grid-template-columns: repeat\(auto-fill, minmax\(240px, 1fr\)\)/s.test(w3b.slice(w3b.indexOf('@media (min-width: 2400px)'))), 'photo tiles reflow instead of four fixed columns');
});

test('settings keeps its form width, the note and search their widths', () => {
  const css = read('src/renderer/src/styles/settings-87.css');
  const at = css.indexOf('@media (min-width: 2400px)');
  assert.ok(at > 0, 'settings answers very wide windows');
  assert.ok(/\.settings-page \.settings-body \{\s*max-width: 880px/s.test(css.slice(at)), 'the body reads 880, near enough to keep each control by its words');
  const frame = read('src/renderer/src/styles/page-frame.css');
  assert.ok(/\.nv-page\.read\s*\{[^}]*max-width:\s*var\(--page-read\)/s.test(frame), 'reading pages keep --page-read');
  const search = read('src/renderer/src/styles/search-ask-87.css');
  assert.ok(search.includes('.sas-modal { width: 680px'), 'the search dialog stays a dialog');
});

// ── Live: one boot, the big vault, every fixed room at 3456 wide ──────────

let H = null;
async function harness() {
  if (!H) {
    H = await startHarness();
    await H.services.invoke('settings:update', [{ prefs: { modules: Object.fromEntries(['finance', 'documents', 'business', 'systems', 'publications', 'goals', 'family', 'health', 'house', 'vehicles', 'career', 'travel', 'meetings', 'lists', 'memories'].map((id) => [id, { on: true }])) } }]);
    const count = writeT200Vault(H.vaultDir);
    assert.equal(count, 3000, 'the walk judges a 3,000-note vault');
    // A few more projects, so Projects home (list and gallery) reads like a real one.
    const w = (rel, text) => {
      const p = path.join(H.vaultDir, ...rel.split('/'));
      mkdirSync(path.dirname(p), { recursive: true });
      writeFileSync(p, text);
    };
    [['Card reader logs review with the bank', 'Alex Chen'], ['Saturday soak test with twenty orders', 'Sam Ortega'], ['ShadeCo fitted price locked in', 'Alex Chen']].forEach(([name, owner], i) => {
      w(`Projects/${name}/${name}.md`, `---\ntype: project\nstatus: active\nhealth: on track\nowner: ${owner}\ndue: 2026-11-${15 + i}\n---\n# ${name}\n\n## Summary\n\nPart of the December rush work at the shop.\n\n## What's next\n\n- [ ] First step for ${name.toLowerCase()} — ${owner} — due 2026-11-${15 + i}\n`);
    });
    await H.services.rescanAll();
    await H.browser.send('Page.navigate', { url: `${H.origin}/harness.html` });
    for (let i = 0; i < 90; i++) {
      await sleep(500);
      try {
        if (await H.browser.ev(`!!document.querySelector('.app')`)) break;
      } catch {}
    }
    await sleep(2500);
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
async function openRoom(h, name) {
  // Settings lives in the account menu (the chip at the sidebar's foot), not as a sidebar row.
  if (name === 'Settings' && (await openSettings(h)) === 'CLICKED') return;
  if ((await clickWords(h, name, '.sidebar.left, aside')) === 'CLICKED') return;
  const label = name === 'Graph' ? 'Open the graph' : name === 'Templates' ? 'Open the Templates page' : name;
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75 });
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75 });
  if (!(await waitFor(h, `!!document.querySelector('.picker input')`, 4000))) {
    assert.equal(await clickWords(h, 'Ask or find anything', '.topbar'), 'CLICKED', 'the palette opens from the top bar');
    assert.ok(await waitFor(h, `!!document.querySelector('.picker input')`), 'the palette input shows');
  }
  await h.browser.send('Input.insertText', { text: name });
  const found = await waitFor(h, `[...document.querySelectorAll('.picker-row')].some((r) => (r.querySelector('.picker-label')?.innerText.trim() ?? '') === ${JSON.stringify(label)})`, 8000);
  assert.ok(found, `${name} answers in the palette`);
  const picked = await h.browser.ev(`(() => {
    const rows = [...document.querySelectorAll('.picker-row')];
    const text = (r, sel) => r.querySelector(sel)?.innerText.trim() ?? '';
    const row = rows.find((r) => text(r, '.picker-label') === ${JSON.stringify(label)} && text(r, '.picker-detail') === 'Pack')
      ?? rows.find((r) => text(r, '.picker-label') === ${JSON.stringify(label)});
    if (!row) return 'NOTFOUND';
    row.click();
    return 'CLICKED';
  })()`);
  assert.equal(picked, 'CLICKED', `${name} opens from the palette`);
  await sleep(600);
}

// The page gutters beside the column, and the nav's own scroll.
const GUTTERS_JS = `(() => {
  const main = document.querySelector('main');
  const box = document.querySelector('main .nv-page, main .vpage.wide, main .td-inner, main .tk-inner, main .tp-inner, main .pv-inner, main .nv-page-frame, main .settings-page');
  if (!main || !box) return { error: 'no page box' };
  const m = main.getBoundingClientRect(), b = box.getBoundingClientRect();
  const nav = document.querySelector('nav.places-list');
  return {
    boxW: Math.round(b.width),
    gutterL: Math.round(b.left - m.left),
    gutterR: Math.round(m.right - b.right),
    navScrolls: nav ? nav.scrollHeight > nav.clientHeight + 1 : null,
    docX: document.documentElement.scrollWidth > window.innerWidth + 1,
  };
})()`;

// Every pairing container on the page: each row-band either holds two (pairing happens) or one spanning
// child (a lone section takes the width) — never one half-width child with an empty slot beside it. Spanning
// reads off grid placement, not width: a capped prose line (the fills line at 76ch) spans its band by design.
const PAIRS_JS = `(() => {
  const out = [];
  const sels = ['.p87-body', '.w3b-page', "div[aria-label='Waiting to be filed']", '.nv-page .w2b-meeting', '.td-else-groups', '.w2b-halves'];
  for (const sel of sels) {
    for (const c of document.querySelectorAll('main ' + sel)) {
      const cr = c.getBoundingClientRect();
      if (cr.width < 2 || cr.height < 2) continue;
      const kids = [...c.children].filter((k) => { const r = k.getBoundingClientRect(); return r.width > 2 && r.height > 2; });
      if (!kids.length) continue;
      const bands = [];
      const tops = kids.map((k) => ({ k, r: k.getBoundingClientRect() })).sort((a, b) => a.r.top - b.r.top);
      for (const { k, r } of tops) {
        let band = bands[bands.length - 1];
        if (!band || r.top > band.bottom + 4) { band = { bottom: -1e9, kids: [] }; bands.push(band); }
        band.bottom = Math.max(band.bottom, r.top + r.height);
        band.kids.push({ w: r.width, col: getComputedStyle(k).gridColumn, label: (k.getAttribute('aria-label') || k.className || k.tagName).toString().slice(0, 40) });
      }
      const inner = cr.width - (parseFloat(getComputedStyle(c).paddingLeft) || 0) - (parseFloat(getComputedStyle(c).paddingRight) || 0);
      out.push({ sel, bands: bands.map((b) => ({ n: b.kids.length, ws: b.kids.map((k) => Math.round(k.w)), cols: b.kids.map((k) => k.col), labels: b.kids.map((k) => k.label) })), inner: Math.round(inner) });
    }
  }
  return out;
})()`;

// Every card on the page against its longest line. A spread row (title at one edge, its facts at the other)
// reads as one full line, so flex and single-track grid rows count at their full row width; every other line
// counts at its rendered line box. Paired and bare lines never sit in a wide box alone. Transient tour cards
// and empty states are not room content.
const CARDS_JS = `(() => {
  const out = [];
  const range = document.createRange();
  for (const card of document.querySelectorAll('main .card, main .gcard, main .w3b-stat')) {
    if (card.closest('[data-tour]') || card.closest('.nv-empty') || card.closest('[role="dialog"]')) continue;
    const r = card.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    let longest = 0;
    for (const el of [card, ...card.querySelectorAll('*')]) {
      const cs = getComputedStyle(el);
      const d = cs.display;
      if (d.includes('flex') && cs.flexDirection !== 'column') longest = Math.max(longest, el.getBoundingClientRect().width);
      else if (d.includes('grid') && cs.gridTemplateColumns.split(' ').length <= 1) longest = Math.max(longest, el.getBoundingClientRect().width);
    }
    try {
      range.selectNodeContents(card);
      for (const rect of range.getClientRects()) longest = Math.max(longest, rect.width);
    } catch {}
    out.push({ w: Math.round(r.width), longest: Math.round(longest), cls: card.className.toString().slice(0, 50) });
  }
  return out;
})()`;

const ROOMS = ['Today', 'Inbox', 'Projects', 'Tasks', 'Meetings', 'Notes', 'People', 'Money', 'Health', 'Goals', 'Business', 'Systems', 'Trips'];

test('no gutter wider than 400px stands empty beside content, and the nav never scrolls', { timeout: 600000 }, async () => {
  const h = await harness();
  await h.browser.send('Emulation.setDeviceMetricsOverride', { width: 3456, height: 1408, deviceScaleFactor: 1, mobile: false });
  await sleep(600);
  for (const room of [...ROOMS, 'Settings', 'Templates']) {
    await openRoom(h, room);
    await sleep(900);
    const m = await h.browser.ev(GUTTERS_JS);
    assert.ok(!m.error, `${room} shows its page box at 3456x1408${m.error ? `: ${m.error}` : ''}`);
    assert.equal(m.docX, false, `${room} scrolls nowhere sideways at 3456x1408`);
    assert.equal(m.navScrolls, false, `the nav never scrolls on ${room} at 3456x1408`);
    assert.ok(m.gutterL <= 400 && m.gutterR <= 400, `${room} leaves no gutter past 400px (left ${m.gutterL}, right ${m.gutterR}, column ${m.boxW})`);
  }
});

test('sections pair with no empty slot: every band pairs or spans', { timeout: 600000 }, async () => {
  const h = await harness();
  await h.browser.send('Emulation.setDeviceMetricsOverride', { width: 3456, height: 1408, deviceScaleFactor: 1, mobile: false });
  await sleep(600);
  let paired = 0;
  for (const room of ROOMS) {
    await openRoom(h, room);
    await sleep(900);
    if (room === 'Today') {
      // Also's groups pair once opened; open them so the walk judges the pairing, not the shut head.
      const show = await h.browser.ev(`(() => { const b = document.querySelector('[data-section="also"] button.td-more'); if (!b) return 'NOBUTTON'; if (b.getAttribute('aria-expanded') === 'true') return 'OPEN'; b.click(); return 'CLICKED'; })()`);
      assert.ok(show === 'CLICKED' || show === 'OPEN', `Also opens (saw ${show})`);
      await sleep(1500);
    }
    const containers = await h.browser.ev(PAIRS_JS);
    for (const c of containers) {
      for (const b of c.bands) {
        if (b.n >= 2) { paired++; continue; }
        assert.ok(b.ws[0] >= c.inner - 8 || b.cols[0] !== 'auto', `${room} ${c.sel}: a lone band takes the width (stood ${b.ws[0]} in ${c.inner}, placed ${b.cols[0]}: ${b.labels.join(', ')})`);
      }
    }
  }
  // Round 3: the Inbox's captures read as one list in their pane beside the capture's detail (list and detail), so
  // they no longer pair across the page: one band fewer than before.
  assert.ok(paired >= 4, `pairing happens across the rooms (stood ${paired} paired bands)`);
});

test('a meeting’s sections pair with no empty slot', { timeout: 600000 }, async () => {
  const h = await harness();
  await h.browser.send('Emulation.setDeviceMetricsOverride', { width: 3456, height: 1408, deviceScaleFactor: 1, mobile: false });
  await sleep(600);
  await openRoom(h, 'Meetings');
  await sleep(1200);
  const opened = await h.browser.ev(`(async () => {
    const row = [...document.querySelectorAll('main .w2b-row, main .trow')].find((e) => { const r = e.getBoundingClientRect(); return r.width > 60 && r.height > 12; });
    if (!row) return 'NOROW';
    row.click();
    await new Promise((r) => setTimeout(r, 1000));
    return 'CLICKED';
  })()`);
  assert.equal(opened, 'CLICKED', 'a meeting opens');
  await sleep(1200);
  const containers = await h.browser.ev(PAIRS_JS);
  const meeting = containers.filter((c) => c.sel === '.nv-page .w2b-meeting');
  assert.ok(meeting.length >= 1, 'the meeting page pairs through the shared rule');
  let paired = 0;
  for (const c of meeting) {
    for (const b of c.bands) {
      if (b.n >= 2) { paired++; continue; }
      assert.ok(b.ws[0] >= c.inner - 8 || b.cols[0] !== 'auto', `a lone meeting band takes the width (stood ${b.ws[0]} in ${c.inner}, placed ${b.cols[0]}: ${b.labels.join(', ')})`);
    }
  }
  assert.ok(paired >= 1, 'the meeting’s sections pair');
});

test('no card is more than about three times wider than its longest line', { timeout: 600000 }, async () => {
  const h = await harness();
  await h.browser.send('Emulation.setDeviceMetricsOverride', { width: 3456, height: 1408, deviceScaleFactor: 1, mobile: false });
  await sleep(600);
  for (const room of ROOMS) {
    await openRoom(h, room);
    await sleep(900);
    const cards = await h.browser.ev(CARDS_JS);
    for (const c of cards) {
      if (c.longest < 10) continue;
      const ratio = c.w / c.longest;
      assert.ok(ratio <= 3.5, `${room}: a card holds its lines (stood ${c.w}px over a ${c.longest}px line, ${ratio.toFixed(1)}x: ${c.cls})`);
    }
  }
});

test('the gallery reflows past three columns', { timeout: 600000 }, async () => {
  const h = await harness();
  await h.browser.send('Emulation.setDeviceMetricsOverride', { width: 3456, height: 1408, deviceScaleFactor: 1, mobile: false });
  await sleep(600);
  await openRoom(h, 'Projects');
  await sleep(1200);
  assert.equal(await clickWords(h, 'Gallery', 'main'), 'CLICKED', 'the gallery opens');
  await sleep(1200);
  const cols = await h.browser.ev(`(() => {
    const gal = document.querySelector('main .gal');
    if (!gal) return { error: 'no gallery' };
    const tops = new Set();
    for (const k of gal.children) {
      const r = k.getBoundingClientRect();
      if (r.width > 2 && r.height > 2) tops.add(Math.round(r.top / 8));
    }
    const first = [...gal.children].map((k) => k.getBoundingClientRect()).filter((r) => r.width > 2 && r.height > 2);
    if (!first.length) return { error: 'no cards' };
    const top = first[0].top;
    return { row: first.filter((r) => Math.abs(r.top - top) <= 8).length, tracks: getComputedStyle(gal).gridTemplateColumns.split(' ').length };
  })()`);
  assert.ok(!cols.error, cols.error ?? '');
  assert.ok(cols.row >= 4, `the gallery reflows past three columns (stood ${cols.row} across, ${cols.tracks} tracks)`);
});

test('the note keeps its reading width and the graph still fills', { timeout: 600000 }, async () => {
  const h = await harness();
  await h.browser.send('Emulation.setDeviceMetricsOverride', { width: 3456, height: 1408, deviceScaleFactor: 1, mobile: false });
  await sleep(600);
  await openRoom(h, 'Notes');
  await sleep(1200);
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75 });
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75 });
  assert.ok(await waitFor(h, `!!document.querySelector('.picker input')`, 5000), 'the palette opens for the note');
  await h.browser.send('Input.insertText', { text: 'Kickoff note 1 with decisions' });
  await sleep(900);
  assert.equal(await h.browser.ev(`(() => { const row = [...document.querySelectorAll('.picker-row')].find((x) => (x.querySelector('.picker-label')?.innerText || '').includes('Kickoff note 1')); if (!row) return 'NOTFOUND'; row.click(); return 'CLICKED'; })()`), 'CLICKED', 'the note opens');
  assert.ok(await waitFor(h, `!!document.querySelector('.nv-note-main')`, 20000), 'the note lands');
  const note = await h.browser.ev(`(() => {
    const main = document.querySelector('.nv-note-main');
    const r = main?.getBoundingClientRect();
    // Round 3: the column grows with the room (lists, tables and the meeting blocks take it); prose keeps a measure.
    const line = [...document.querySelectorAll('.nv-note-main .cm-content > .cm-line:not(.cm-nv-list-line)')].find((e) => e.textContent.trim().length > 20);
    const cs = line ? getComputedStyle(line) : null;
    const prose = line ? Math.round(line.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)) : 0;
    return main && r ? { w: Math.round(r.width), prose } : { error: 'no note column' };
  })()`);
  assert.ok(!note.error, note.error ?? '');
  assert.ok(note.prose <= 1120, `the note keeps its reading width, far from the rooms’ column (prose stood ${note.prose} in ${note.w})`);
  await openRoom(h, 'Graph');
  assert.ok(await waitFor(h, `window.__nvBrainGraph && window.__nvBrainGraph.snapshot().count > 0`), 'points draw');
  await sleep(1200);
  const g = await h.browser.ev(`(() => {
    const cr = document.querySelector('.bg-canvas')?.getBoundingClientRect();
    const br = document.querySelector('.nj-graph-body')?.getBoundingClientRect();
    return cr && br ? { dw: Math.abs(cr.width - br.width), dh: Math.abs(cr.height - br.height) } : { error: 'no canvas' };
  })()`);
  assert.ok(!g.error, g.error ?? '');
  assert.ok(g.dw <= 2 && g.dh <= 2, 'the canvas still fills the page');
});

// ── t258: the Vault's inner pages (13 Nov 2026, at 3456x1408). t254 fixed the rooms; its "Not done"
// list is here: w3b detail pages'
// boxed one-liners (now bare through one shared RowsCard), the Bin at 0/3/300, Board and Timeline,
// and every other inner page. Each live walk below asserts the same three: gutters 400 or less, no
// empty pair slot, no card more than 3.5x its longest line.

test('w3b detail one-liners read bare through one shared place, never a card (t258)', () => {
  const w3b = read('src/renderer/src/views/modules/w3b/W3b.tsx');
  assert.ok(w3b.includes('export function RowsCard'), 'the shared RowsCard lives in W3b.tsx');
  assert.ok(w3b.includes('<p className="vsub w3b-bare">'), 'bare skips the card box, as the overviews do');
  assert.ok(read('src/renderer/src/styles/w3b-packs.css').includes('.w3b-bare {'), 'the bare line has its one shared style');
  for (const [file, words] of [
    ['src/renderer/src/views/modules/w3b/House87.tsx', 'RowsCard empty={!a.files.length}'],
    ['src/renderer/src/views/modules/w3b/Travel87.tsx', 'RowsCard empty={!x.bookings.length}'],
    ['src/renderer/src/views/modules/w3b/Travel87.tsx', 'RowsCard empty={!x.files.length}'],
    ['src/renderer/src/views/modules/w3b/Lists87.tsx', 'RowsCard empty={!items.length}'],
    ['src/renderer/src/views/modules/w3b/Vehicles87.tsx', 'RowsCard empty={!fills.length}'],
    ['src/renderer/src/views/modules/w3b/Vehicles87.tsx', 'RowsCard empty={!v.trips.length}'],
    ['src/renderer/src/views/modules/w3b/Vehicles87.tsx', 'RowsCard empty={!services.length && !canEdit}'],
    ['src/renderer/src/views/modules/w3b/Family87.tsx', 'RowsCard empty={!milestones.length}'],
  ]) {
    assert.ok(read(file).includes(words), `${file} bares through the shared card (${words})`);
  }
  const w3bCss = read('src/renderer/src/styles/w3b-packs.css');
  const bareAt = w3bCss.indexOf('.w3b-bare {');
  assert.ok(bareAt > 0, 'the shared rule is found');
  assert.ok(!/:has\(/.test(w3bCss.slice(bareAt, bareAt + 400)), 'no :has() in the shared rule');
});

test("an appliance's page opens (t258: slice(11) dropped its first letter)", () => {
  const src = read('src/renderer/src/views/modules/w3b/House87.tsx');
  assert.ok(src.includes('part.slice(10)'), 'appliance: is 10 long, so the path survives');
  assert.ok(!src.includes('part.slice(11)'), 'the off-by-one is gone');
});

// Writes one empty-everywhere record per w3b pack for the detail walk below. Made-up only.
function writeT258ModuleData(dir) {
  const w = (rel, text) => {
    const p = path.join(dir, ...rel.split('/'));
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, text);
  };
  w('Home/House/Appliances/Toaster.md', `---\ntype: appliance\nkind: Toaster\nroom: Kitchen\nmake: Brightline\nmodel: T2\nserial: T2-0001\npurchased: 2024-11-20\nprice: 79\nsupplier: Appliance Barn\nwarranty: 2026-11-20\nstatus: In use\n---\n## Service history\n\n| Date | What | By | Cost | Notes |\n| --- | --- | --- | --- | --- |\n\n## Notes\n\n`);
  w('Me/Travel/Trips/Empty Trip.md', `---\ntype: trip\ndestination: Nowhere\npurpose: Personal\nstarts: 2026-12-11\nends: 2026-12-13\nstatus: Planning\nbudget: 500\n---\n## Itinerary\n\n| Date | Time | Kind | What | Until | Where | Booking | Cost | Paid | Notes |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n\n## Expenses\n\n| Date | What | Category | Amount | Paid by | Notes |\n| --- | --- | --- | --- | --- | --- |\n\n## Notes\n\n`);
  w('Me/Lists/Empty Shopping.md', `---\ntype: list\nkind: Shopping\nfor:\n---\n## Items\n\n| Item | Status | Qty | Shop | Note | Added |\n| --- | --- | --- | --- | --- | --- |\n| Milk | Need | 2 | Corner shop |  |  |\n`);
  w('Home/Vehicles/Empty Car.md', `---\ntype: vehicle\nkind: Car\nmake: Roadster\nmodel: Empty\nrego: XYZ999\nfuel: Petrol\nstatus: Active\n---\n## Fuel log\n\n| Date | Odometer | Litres | Cost | Full | Station | Notes |\n| --- | --- | --- | --- | --- | --- | --- |\n\n## Service history\n\n| Date | Odometer | What | Where | Cost | Notes |\n| --- | --- | --- | --- | --- | --- |\n\n## Trips\n\n| Date | Reason | Km | Notes |\n| --- | --- | --- | --- |\n\n## Notes\n\n`);
  w('Family/People/Test Person.md', `---\ntype: person\nfamily: Cousin\nborn: 2010-05-01\ncolour: sky\nsensitivity: family\n---\n# Test Person\n\n## Documents\n\n`);
  w('Family/Family calendar.md', `---\ntype: family-calendar\nsensitivity: family\n---\n# Family calendar\n\nWho’s where each week.\n\n## Activities\n\n| Who | What | Day | Time | Where | Until |\n| --- | --- | --- | --- | --- | --- |\n\n## Events\n\n| Date | Time | Who | What | Where |\n| --- | --- | --- | --- | --- | --- |\n\n## Milestones\n\n| Date | Who | Milestone |\n| --- | --- | --- |\n`);
}

test('w3b detail pages: gutters 400 or less, pairs hold, no boxed one-liner (t258)', { timeout: 600000 }, async () => {
  const h = await harness();
  writeT258ModuleData(h.vaultDir);
  await h.services.rescanAll();
  await h.browser.send('Emulation.setDeviceMetricsOverride', { width: 3456, height: 1408, deviceScaleFactor: 1, mobile: false });
  await sleep(600);
  const opens = [
    ['appliance', async () => { await openRoom(h, 'House'); assert.equal(await clickWords(h, 'Toaster', 'main'), 'CLICKED', 'the appliance opens'); }],
    ['trip', async () => { await openRoom(h, 'Trips'); assert.equal(await clickWords(h, 'Empty Trip', 'main'), 'CLICKED', 'the trip opens'); }],
    ['list', async () => { await openRoom(h, 'Lists'); assert.equal(await clickWords(h, 'Milk', 'main'), 'CLICKED', 'the list opens'); assert.equal(await clickWords(h, 'Got', 'main'), 'CLICKED', 'its empty Done tab shows'); }],
    ['vehicle', async () => { await openRoom(h, 'Cars'); assert.equal(await clickWords(h, 'Empty Car', 'main'), 'CLICKED', 'the car opens'); }],
    ['member', async () => { await openRoom(h, 'Family'); assert.equal(await h.browser.ev(`(() => { const b = [...document.querySelectorAll('main button[title^="Open Test Person"]')].find((e) => e.getBoundingClientRect().width > 2); if (!b) return 'NOTFOUND'; b.click(); return 'CLICKED'; })()`), 'CLICKED', 'the member opens'); }],
  ];
  for (const [id, open] of opens) {
    await open();
    await sleep(1200);
    const m = await h.browser.ev(GUTTERS_JS);
    assert.ok(!m.error, `${id} shows its page box${m.error ? `: ${m.error}` : ''}`);
    assert.equal(m.docX, false, `${id} scrolls nowhere sideways`);
    assert.equal(m.navScrolls, false, `the nav never scrolls on ${id}`);
    assert.ok(m.gutterL <= 400 && m.gutterR <= 400, `${id} leaves no gutter past 400px (left ${m.gutterL}, right ${m.gutterR}, column ${m.boxW})`);
    const containers = await h.browser.ev(PAIRS_JS);
    for (const c of containers) for (const b of c.bands) {
      if (b.n >= 2) continue;
      assert.ok(b.ws[0] >= c.inner - 8 || b.cols[0] !== 'auto', `${id} ${c.sel}: a lone band takes the width`);
    }
    const cards = await h.browser.ev(CARDS_JS);
    for (const c of cards) {
      if (c.longest < 10) continue;
      assert.ok(c.w / c.longest <= 3.5, `${id}: a card holds its lines (stood ${c.w}px over ${c.longest}px, ${(c.w / c.longest).toFixed(1)}x: ${c.cls})`);
    }
  }
});

test('the Bin walks with 0, 3 and 300 items: gutters hold, no boxed line (t258)', { timeout: 600000 }, async () => {
  const h = await harness();
  await h.browser.send('Emulation.setDeviceMetricsOverride', { width: 3456, height: 1408, deviceScaleFactor: 1, mobile: false });
  await sleep(600);
  async function openBinFresh() {
    await openRoom(h, 'Today');
    await sleep(600);
    await h.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75 });
    await h.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75 });
    assert.ok(await waitFor(h, `!!document.querySelector('.picker input')`, 5000), 'the palette opens for the Bin');
    await h.browser.send('Input.insertText', { text: 'Open the Bin' });
    await sleep(900);
    assert.equal(await h.browser.ev(`(() => { const r = [...document.querySelectorAll('.picker-row')].find((x) => (x.querySelector('.picker-label')?.innerText.trim() ?? '') === 'Open the Bin'); if (!r) return 'NOTFOUND'; r.click(); return 'CLICKED'; })()`), 'CLICKED', 'the Bin opens');
    await sleep(1200);
  }
  async function checkBin(want) {
    const m = await h.browser.ev(GUTTERS_JS);
    assert.ok(!m.error, `Bin(${want}) shows its box`);
    assert.equal(m.docX, false, `Bin(${want}) scrolls nowhere sideways`);
    assert.equal(m.navScrolls, false, 'the nav never scrolls on the Bin');
    assert.ok(m.gutterL <= 400 && m.gutterR <= 400, `Bin(${want}) leaves no gutter past 400px (left ${m.gutterL}, right ${m.gutterR})`);
    const n = await h.browser.ev(`document.querySelectorAll('main .bin-list-87 li').length`);
    if (want > 0) assert.ok(n >= Math.min(want, 3), `Bin(${want}) lists its items (stood ${n})`);
    const cards = await h.browser.ev(CARDS_JS);
    for (const c of cards) {
      if (c.longest < 10) continue;
      assert.ok(c.w / c.longest <= 3.5, `Bin(${want}): a card holds its lines (${c.w}/${c.longest})`);
    }
  }
  await openBinFresh();
  await checkBin(0);
  // Trash 3 real notes through the backend, then 300 more; the Bin lists what the backend holds.
  function listMd(dir, base = '') {
    const out = [];
    for (const e of readdirSync(dir)) {
      const p = path.join(dir, e), rel = base ? `${base}/${e}` : e;
      if (statSync(p).isDirectory()) out.push(...listMd(p, rel));
      else if (e.endsWith('.md')) out.push(rel);
    }
    return out;
  }
  const trashable = listMd(h.vaultDir).filter((p) => !p.includes('Projects/') && !p.includes('People/'));
  assert.ok(trashable.length >= 310, `the vault offers notes to delete (stood ${trashable.length})`);
  await h.browser.ev(`(async () => { for (const p of ${JSON.stringify(trashable.slice(0, 3))}) { try { await window.nv.files.trash(p); } catch {} } })()`);
  await sleep(800);
  await openBinFresh();
  await checkBin(3);
  await h.browser.ev(`(async () => { for (const p of ${JSON.stringify(trashable.slice(3, 303))}) { try { await window.nv.files.trash(p); } catch {} } })()`);
  await sleep(1500);
  await openBinFresh();
  await checkBin(300);
});

test('Board and Timeline run full width with no boxed line (t258)', { timeout: 600000 }, async () => {
  const h = await harness();
  await h.browser.send('Emulation.setDeviceMetricsOverride', { width: 3456, height: 1408, deviceScaleFactor: 1, mobile: false });
  await sleep(600);
  await openRoom(h, 'Projects');
  await sleep(900);
  assert.equal(await clickWords(h, 'Board', 'main'), 'CLICKED', 'the board opens');
  await sleep(1200);
  let m = await h.browser.ev(GUTTERS_JS);
  assert.ok(m.gutterL <= 400 && m.gutterR <= 400, `Board leaves no gutter past 400px (left ${m.gutterL}, right ${m.gutterR}, width ${m.boxW})`);
  const cols = await h.browser.ev(`[...document.querySelectorAll('main .board .bcol')].map((c) => Math.round(c.getBoundingClientRect().width))`);
  assert.ok(cols.length >= 4 && cols.every((w) => w > 200), `the board's columns share the width (${cols.join('/')})`);
  for (const c of await h.browser.ev(CARDS_JS)) {
    if (c.longest < 10) continue;
    assert.ok(c.w / c.longest <= 3.5, `board: a card holds its lines (${c.w}/${c.longest})`);
  }
  assert.equal(await clickWords(h, 'Timeline', 'main'), 'CLICKED', 'the timeline opens');
  await sleep(1500);
  const t = await h.browser.ev(`(() => { const g = document.querySelector('main .n3-gantt'); const main = document.querySelector('main'); if (!g || !main) return { error: 'no gantt' }; const r = g.getBoundingClientRect(), b = main.getBoundingClientRect(); return { L: Math.round(r.left - b.left), R: Math.round(b.right - r.right), W: Math.round(r.width) }; })()`);
  assert.ok(!t.error, 'the timeline draws');
  assert.ok(t.L <= 400 && t.R <= 400, `Timeline leaves no gutter past 400px (left ${t.L}, right ${t.R}, width ${t.W})`);
  for (const c of await h.browser.ev(CARDS_JS)) {
    if (c.longest < 10) continue;
    assert.ok(c.w / c.longest <= 3.5, `timeline: a card holds its lines (${c.w}/${c.longest})`);
  }
});

test('Import, Tidy, Export, Person and Template hold the column with no boxed line (t258)', { timeout: 600000 }, async () => {
  const h = await harness();
  await h.browser.send('Emulation.setDeviceMetricsOverride', { width: 3456, height: 1408, deviceScaleFactor: 1, mobile: false });
  await sleep(600);
  async function openPaletteLabel(label) {
    await h.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75 });
    await h.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75 });
    assert.ok(await waitFor(h, `!!document.querySelector('.picker input')`, 5000), `the palette opens for ${label}`);
    await h.browser.send('Input.insertText', { text: label });
    await sleep(900);
    assert.equal(await h.browser.ev(`(() => { const r = [...document.querySelectorAll('.picker-row')].find((x) => (x.querySelector('.picker-label')?.innerText.trim() ?? '') === ${JSON.stringify(label)}); if (!r) return 'NOTFOUND'; r.click(); return 'CLICKED'; })()`), 'CLICKED', `${label} opens`);
    await sleep(900);
  }
  const pages = [
    ['import', async () => { await openPaletteLabel('Import: emails, PDFs, CSV spreadsheets, notes and folders'); }],
    ['tidy', async () => { await openPaletteLabel('Open the weekly tidy'); }],
    ['export', async () => { await openPaletteLabel('Export everything as a zip (notes, files and tables)'); }],
    ['person', async () => { await openRoom(h, 'People'); assert.equal(await clickWords(h, 'Alex Chen', 'main'), 'CLICKED', 'the person opens'); await sleep(600); }],
    ['template', async () => { await openRoom(h, 'Templates'); await sleep(600); }],
  ];
  for (const [id, open] of pages) {
    await open();
    await sleep(900);
    const m = await h.browser.ev(GUTTERS_JS);
    assert.ok(!m.error, `${id} shows its box`);
    assert.equal(m.docX, false, `${id} scrolls nowhere sideways`);
    assert.equal(m.navScrolls, false, `the nav never scrolls on ${id}`);
    assert.ok(m.gutterL <= 400 && m.gutterR <= 400, `${id} leaves no gutter past 400px (left ${m.gutterL}, right ${m.gutterR}, width ${m.boxW})`);
    const cards = await h.browser.ev(CARDS_JS);
    for (const c of cards) {
      if (c.longest < 10) continue;
      assert.ok(c.w / c.longest <= 3.5, `${id}: a card holds its lines (${c.w}/${c.longest}: ${c.cls})`);
    }
  }
});

test('record, tag, folder and search-as-page hold with no boxed line (t258 remainder)', { timeout: 600000 }, async () => {
  const h = await harness();
  await h.browser.send('Emulation.setDeviceMetricsOverride', { width: 3456, height: 1408, deviceScaleFactor: 1, mobile: false });
  await sleep(600);
  async function checkPage(id) {
    const m = await h.browser.ev(GUTTERS_JS);
    assert.ok(!m.error, `${id} shows its box${m.error ? `: ${m.error}` : ''}`);
    assert.equal(m.docX, false, `${id} scrolls nowhere sideways`);
    assert.equal(m.navScrolls, false, `the nav never scrolls on ${id}`);
    assert.ok(m.gutterL <= 400 && m.gutterR <= 400, `${id} leaves no gutter past 400px (left ${m.gutterL}, right ${m.gutterR}, width ${m.boxW})`);
    for (const c of await h.browser.ev(CARDS_JS)) {
      if (c.longest < 10) continue;
      assert.ok(c.w / c.longest <= 3.5, `${id}: a card holds its lines (${c.w}/${c.longest}: ${c.cls})`);
    }
  }
  async function openPaletteLabel(label) {
    await h.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75 });
    await h.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75 });
    assert.ok(await waitFor(h, `!!document.querySelector('.picker input')`, 5000), `the palette opens for ${label}`);
    await h.browser.send('Input.insertText', { text: label });
    await sleep(900);
    assert.equal(await h.browser.ev(`(() => { const r = [...document.querySelectorAll('.picker-row')].find((x) => (x.querySelector('.picker-label')?.innerText.trim() ?? '') === ${JSON.stringify(label)}); if (!r) return 'NOTFOUND'; r.click(); return 'CLICKED'; })()`), 'CLICKED', `${label} opens`);
    await sleep(900);
  }
  // Tag page and folder's page: SavedViews made through New view (source picker
  // takes #tag or folder, then a name, then the file kind).
  async function makeView(sourceQuery, sourceId, name) {
    await openPaletteLabel('New view of notes (table, cards, list, board or calendar)…');
    await sleep(800);
    assert.ok(await waitFor(h, `!!document.querySelector('[role="dialog"] input')`, 5000), 'the source picker opens');
    await h.browser.send('Input.insertText', { text: sourceQuery });
    await sleep(900);
    const picked = await h.browser.ev(`(() => {
      const rows = [...document.querySelectorAll('[role="dialog"] [role="option"], [role="dialog"] button, .picker-row')];
      const el = rows.find((e) => (e.innerText || '').includes(${JSON.stringify(sourceId)}));
      if (!el) return 'NOTFOUND: ' + rows.slice(0, 3).map((e) => (e.innerText || '').slice(0, 30)).join('|');
      el.click(); return 'CLICKED';
    })()`);
    assert.equal(picked, 'CLICKED', `${sourceId} picked (${picked})`);
    await sleep(900);
    assert.ok(await waitFor(h, `!!document.querySelector('[role="dialog"] input')`, 5000), 'the name prompt opens');
    await h.browser.ev(`(() => { const i = document.querySelector('[role="dialog"] input'); if (i) { i.focus(); i.select(); } })()`);
    await h.browser.send('Input.insertText', { text: name });
    await sleep(500);
    await h.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await h.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await sleep(1200);
    // The file-kind chooser (Ironleaf's own vs .base), if shown.
    const kind = await h.browser.ev(`(() => {
      const els = [...document.querySelectorAll('[role="dialog"] button')].filter((e) => e.getBoundingClientRect().width > 2);
      const el = els.find((e) => (e.innerText || '').includes('Ironleaf'));
      if (!el) return 'NONE';
      el.click(); return 'CLICKED';
    })()`);
    if (kind === 'CLICKED') await sleep(1500);
    else await sleep(800);
  }
  await makeView('#harbourline', '#harbourline', 'TagTest');
  await sleep(1200);
  await checkPage('tag');
  await makeView('Work', 'Work', 'FolderTest');
  await sleep(1200);
  await checkPage('folder');
  // A record's page: Money bill detail from Bills due.
  await openRoom(h, 'Money');
  await sleep(900);
  assert.equal(await clickWords(h, 'Harbour Internet', 'main'), 'CLICKED', 'the bill opens');
  await sleep(1200);
  await checkPage('record');
  // Search results opened as a page: the search window with a query stays a centred
  // dialog by design (t254 exempt); it never strands a wide page.
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75 });
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75 });
  assert.ok(await waitFor(h, `!!document.querySelector('.picker input')`, 5000), 'the palette opens for search');
  await h.browser.send('Input.insertText', { text: 'Search inside notes and project files' });
  await sleep(900);
  assert.equal(await h.browser.ev(`(() => { const r = [...document.querySelectorAll('.picker-row')].find((x) => (x.querySelector('.picker-label')?.innerText.trim() ?? '') === 'Search inside notes and project files'); if (!r) return 'NOTFOUND'; r.click(); return 'CLICKED'; })()`), 'CLICKED', 'search opens');
  await sleep(1000);
  const dlg = await h.browser.ev(`(() => { const d = document.querySelector('.sas-modal, [role="dialog"]'); if (!d) return { error: 'no dialog' }; const r = d.getBoundingClientRect(); return { w: Math.round(r.width), x: Math.round(r.left) }; })()`);
  assert.ok(!dlg.error, 'the search window opens');
  assert.ok(dlg.w <= 720, `the search window stays a dialog, never a wide page (stood ${dlg.w}px)`);
});
